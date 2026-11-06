use super::*;
use crate::compile::testing::{default_settings, with_bind_input_and_provider};
use crate::load::source_provider::{
    DeferredLoad, LoadRequest, Loaded, MacroCall, ModuleName, Resolution, ResolveRequest,
    SourceFile, WithoutServices,
};
use crate::modules::BindInput;
use crate::modules::testing::file_named;
use bun_ast::Loader;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::DataModule;
use bun_sema::session::Session;
use bun_threading::Guarded;

const TWO_PAGES: [(&str, &str); 3] = [
    (
        "main.js",
        "import home from './home.html';\nimport about from './pages/about.html';\n\
         console.log(home, about);\n",
    ),
    ("home.html", "<html></html>"),
    ("pages/about.html", "<html></html>"),
];
const NO_PAGES: [(&str, &str); 1] = [("main.js", "console.log(1);\n")];

#[derive(Clone, PartialEq, Eq, Debug)]
enum ProviderCall {
    BundlePages(Vec<Vec<u8>>),
    CheckEmbeddedFiles,
}

#[derive(Default)]
struct PageBundler {
    fails_to_bundle: bool,
    finds_collision: bool,
    omits_manifests: bool,
    calls: Guarded<Vec<ProviderCall>>,
}

impl SourceProvider for PageBundler {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        WithoutServices.has_load_plugin(module)
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        match file.loader {
            Loader::Html => Ok(DataModule::Page),
            _ => WithoutServices.parse_data(file, arena, atoms, log),
        }
    }

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        WithoutServices.run_macro(call, arena, atoms, log)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
        _log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        let paths = pages.iter().map(|page| page.to_vec()).collect();
        self.calls.lock().push(ProviderCall::BundlePages(paths));
        if self.fails_to_bundle {
            return Err(Failed);
        }
        if self.omits_manifests {
            return Ok(Vec::new());
        }
        let create_manifest = |page: &&[u8]| -> &'s DataValue<'s> {
            let index = (
                atoms.intern(b"index"),
                DataValue::String(atoms.intern(page)),
            );
            arena.alloc(DataValue::Object(arena.alloc_slice_copy(&[index])))
        };
        Ok(pages.iter().map(create_manifest).collect())
    }

    fn check_embedded_files(&self, _log: &mut Log) -> Result<(), Failed> {
        self.calls.lock().push(ProviderCall::CheckEmbeddedFiles);
        match self.finds_collision {
            true => Err(Failed),
            false => Ok(()),
        }
    }
}

fn with_bundle(
    files: &[(&str, &str)],
    provider: &PageBundler,
    check: impl for<'s> FnOnce(&BindInput<'_, '_>, &Interner<'s>, Result<DeferredData<'s>, Failed>),
) {
    with_bind_input_and_provider(files, &default_settings(), provider, |input| {
        assert!(provider.calls.lock().is_empty());
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let mut log = Log::init();
        let data = bundle_pages(input.sources, provider, session.arena(), &atoms, &mut log);
        check(input, &atoms, data);
    });
}

fn page_paths(input: &BindInput<'_, '_>) -> Vec<Vec<u8>> {
    let pages = input.sources.pages().iter();
    pages.map(|(_, path)| path.to_vec()).collect()
}

#[test]
fn manifests_are_found_by_file() {
    let provider = PageBundler::default();
    with_bundle(&TWO_PAGES, &provider, |input, atoms, data| {
        let data = data.expect("the bundle succeeds");
        for (name, base_name) in [
            ("home.html", "home.html"),
            ("pages/about.html", "about.html"),
        ] {
            let file = file_named(input, name);
            let mut pages = input.sources.pages().iter();
            let page = pages.find(|page| page.0 == file);
            let (_, path) = page.expect("the file is a page");
            assert!(path.ends_with(base_name.as_bytes()), "{name}");
            let index = (
                atoms.intern(b"index"),
                DataValue::String(atoms.intern(path)),
            );
            assert_eq!(data.get(file), Some(&DataValue::Object(&[index])), "{name}");
        }
    });
}

#[test]
fn pages_are_bundled_in_one_call() {
    let provider = PageBundler::default();
    with_bundle(&TWO_PAGES, &provider, |input, _, data| {
        assert!(data.is_ok());
        let paths = page_paths(input);
        assert_eq!(paths.len(), 2);
        let expected = [
            ProviderCall::BundlePages(paths),
            ProviderCall::CheckEmbeddedFiles,
        ];
        assert_eq!(*provider.calls.lock(), expected);
        let page_files: Vec<FileId> = input.sources.pages().iter().map(|page| page.0).collect();
        let mut expected_files = ["home.html", "pages/about.html"].map(|it| file_named(input, it));
        expected_files.sort_unstable();
        assert_eq!(page_files, expected_files);
    });
}

#[test]
fn no_pages_call_with_empty_list() {
    let provider = PageBundler::default();
    with_bundle(&NO_PAGES, &provider, |_, _, data| {
        assert!(data.is_ok());
        let expected = [
            ProviderCall::BundlePages(Vec::new()),
            ProviderCall::CheckEmbeddedFiles,
        ];
        assert_eq!(*provider.calls.lock(), expected);
    });
}

#[test]
fn failed_bundle_fails() {
    let provider = PageBundler {
        fails_to_bundle: true,
        ..PageBundler::default()
    };
    with_bundle(&TWO_PAGES, &provider, |input, _, data| {
        assert!(data.is_err());
        let expected = [ProviderCall::BundlePages(page_paths(input))];
        assert_eq!(*provider.calls.lock(), expected);
    });
}

#[test]
fn file_without_page_has_no_data() {
    let provider = PageBundler::default();
    with_bundle(&TWO_PAGES, &provider, |input, _, data| {
        let data = data.expect("the bundle succeeds");
        assert_eq!(data.get(file_named(input, "main.js")), None);
        let home = file_named(input, "home.html");
        assert!(data.get(home).is_some());
        assert_eq!(DeferredData::default().get(home), None);
    });
}

#[test]
fn collision_check_runs_after_the_bundle() {
    let provider = PageBundler {
        finds_collision: true,
        ..PageBundler::default()
    };
    with_bundle(&TWO_PAGES, &provider, |input, _, data| {
        assert!(data.is_err());
        let expected = [
            ProviderCall::BundlePages(page_paths(input)),
            ProviderCall::CheckEmbeddedFiles,
        ];
        assert_eq!(*provider.calls.lock(), expected);
    });
}

#[test]
#[should_panic(expected = "one manifest for each page")]
fn missing_manifest_panics() {
    let provider = PageBundler {
        omits_manifests: true,
        ..PageBundler::default()
    };
    with_bundle(&TWO_PAGES, &provider, |_, _, _| {});
}

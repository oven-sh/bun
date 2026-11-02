use bstr::BString;
use bun_ast::Log;
use bun_core::strings::index_of;
use bun_sema::atom::Interner;
use bun_sema::erasure::find_type_ranges_beside;
use bun_sema::fold::{Define, DefinePath, DefineRoot, DefineValue, FoldOptions};
use bun_sema::hir_from_data::DataModule;
use bun_sema::session::Arena;

use super::find_text_replaced_by_bundling;
use crate::compile::testing::{default_settings, with_bind_input_and_provider};
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest, SourceFile,
    SourceProvider, WithoutServices,
};

/// `--define NAME=<value>`: the value is one name.
struct NameByDefine<'a>(&'a str);

impl SourceProvider for NameByDefine<'_> {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        let define = Define {
            path: DefinePath {
                root: DefineRoot::Global(atoms.intern(b"NAME")),
                members: &[],
            },
            value: DefineValue::GlobalPath(
                arena.alloc_slice_copy(&[atoms.intern(self.0.as_bytes())]),
            ),
        };
        FoldOptions {
            defines: arena.alloc_slice_copy(&[define]),
            ..WithoutServices.fold_options(arena, atoms, log)
        }
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
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

/// What is put in place of the `NAME` of `return NAME;`. Every position counts from where `NAME` starts.
#[derive(PartialEq, Eq, Debug)]
struct InPlaceOfName {
    /// Where each part starts and ends in the source, and its text.
    parts: Vec<(u32, u32, BString)>,
    /// Where `TypeRanges::map_offset` puts the end of `NAME`.
    end: u32,
    /// What the kept text holds from the start of `NAME` to there.
    kept: BString,
}

// With `--define NAME=<value>`, in a function whose parameter has the name that is the value.
fn find_in_place_of_name(value: &str) -> InPlaceOfName {
    let source = format!("export function probe({value}) {{ return NAME; }}\n");
    let start = index_of(source.as_bytes(), b"NAME").expect("the source has the name") as u32;
    let files = [("main.js", source.as_str())];
    let provider = NameByDefine(value);
    with_bind_input_and_provider(&files, &default_settings(), &provider, |input| {
        let main = input.files.entry_points()[0];
        let module = input.files.module(main);
        let replaced = find_text_replaced_by_bundling(
            &module.hir,
            &module.bound,
            &input.files.analysis(main).decisions,
            &input.files.atoms,
            &|_| None,
        );
        let parts = replaced.iter().map(|part| {
            let text = BString::from(&part.text[..]);
            (part.start - start, part.end - start, text)
        });
        let parts: Vec<(u32, u32, BString)> = parts.collect();
        let type_ranges = find_type_ranges_beside(&module.hir, replaced);
        let kept = type_ranges.remove_from(&module.hir.text);
        let (from, to) = (
            type_ranges.map_offset(start),
            type_ranges.map_offset(start + 4),
        );
        assert_eq!(from, start, "nothing in front of the name is replaced");
        InPlaceOfName {
            parts,
            end: to - start,
            kept: BString::from(&kept[from as usize..to as usize]),
        }
    })
}

#[test]
fn one_name_of_a_define_is_whole_between_the_ends_of_the_written_name() {
    // A value that is longer than `NAME` ends inside the name: what it adds lies in front of where the name ends.
    let rows: [(&str, &[(u32, u32, &str)]); 3] = [
        ("target", &[(0, 3, "target"), (3, 4, "")]),
        ("part", &[(0, 4, "part")]),
        ("it", &[(0, 4, "it")]),
    ];
    for (value, parts) in rows {
        let parts = parts
            .iter()
            .map(|&(start, end, text)| (start, end, BString::from(text)));
        let expected = InPlaceOfName {
            parts: parts.collect(),
            end: value.len() as u32,
            kept: BString::from(value),
        };
        assert_eq!(
            find_in_place_of_name(value),
            expected,
            "--define NAME={value}"
        );
    }
}

use super::*;
use bun_ast::Kind;
use bun_core::strings;
use bun_sema::session::Session;
use bun_sema_standalone as _;

const PROGRAM_FILE: ModuleName<'static> = ModuleName {
    namespace: b"file",
    path: b"/project/a.ts",
};

fn load(read_file: &dyn Fn() -> Option<Cow<'static, [u8]>>) -> Loaded {
    let request = LoadRequest {
        module: PROGRAM_FILE,
        default_loader: Loader::Ts,
        read_file,
    };
    let mut log = Log::init();
    let loaded = WithoutServices.load(&request, &mut log).unwrap();
    assert!(log.msgs.is_empty());
    loaded
}

fn assert_unsupported(log: &Log, feature: &[u8]) {
    assert_eq!((log.msgs.len(), log.errors), (1, 1));
    let message = &log.msgs[0];
    assert_eq!(message.kind, Kind::Err);
    assert!(message.data.text.starts_with(b"TS100050: "));
    assert!(strings::contains(&message.data.text, feature));
}

#[test]
fn load_returns_file_contents() {
    let Loaded::Source {
        contents,
        loader,
        is_from_plugin,
    } = load(&|| Some(Cow::Borrowed(b"let a".as_slice())))
    else {
        panic!("expected Loaded::Source");
    };
    assert_eq!(&*contents, b"let a");
    assert_eq!(loader, Loader::Ts);
    assert!(!is_from_plugin);
}

#[test]
fn load_reports_missing_file() {
    assert!(matches!(load(&|| None), Loaded::NotFound));
}

#[test]
fn has_no_plugins_or_defines() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let mut log = Log::init();
    let options = WithoutServices.fold_options(session.arena(), &atoms, &mut log);
    assert!(options.defines.is_empty());
    assert!(options.dropped_calls.is_empty());
    assert!(options.features.is_empty());
    assert!(!options.preserves_unused_imports);

    let request = ResolveRequest {
        specifier: b"./b",
        importer: PROGRAM_FILE,
        kind: ImportKind::Stmt,
    };
    let resolution = WithoutServices.resolve(&request, &mut log).unwrap();
    assert!(matches!(resolution, Resolution::NotHandled));
    assert!(!WithoutServices.has_load_plugin(PROGRAM_FILE));
    assert!(WithoutServices.finish_deferred_loads(&mut log).is_empty());
    assert!(log.msgs.is_empty());
}

#[test]
fn json_loaders_parse_values() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    for loader in [Loader::Json, Loader::Jsonc] {
        let file = SourceFile {
            path: b"/project/a.json",
            contents: br#"{"a":[1,-2,null]}"#,
            loader,
        };
        let mut log = Log::init();
        let module = WithoutServices
            .parse_data(&file, session.arena(), &atoms, &mut log)
            .unwrap();
        let items = [
            DataValue::Number(1.0),
            DataValue::Number(-2.0),
            DataValue::Null,
        ];
        let entries = [(atoms.intern(b"a"), DataValue::Array(&items))];
        let expected = DataModule::Value {
            default: &DataValue::Object(&entries),
            exports_keys: true,
        };
        assert_eq!(module, expected);
        assert!(log.msgs.is_empty());
    }
}

#[test]
fn text_loader_returns_string_and_replaces_ill_formed_bytes() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let replaced = "a\u{FFFD}b\u{FFFD}c\u{FFFD}\u{FFFD}\u{FFFD}";
    let texts: [(&[u8], &[u8]); 2] = [
        (b"{\"a\":1}\n", b"{\"a\":1}\n"),
        (b"a\xFFb\xE2\x82c\xED\xA0\x80", replaced.as_bytes()),
    ];
    for (contents, text) in texts {
        let file = SourceFile {
            path: b"/project/a.txt",
            contents,
            loader: Loader::Text,
        };
        let mut log = Log::init();
        let module = WithoutServices
            .parse_data(&file, session.arena(), &atoms, &mut log)
            .unwrap();
        let expected = DataModule::Value {
            default: &DataValue::String(atoms.intern(text)),
            exports_keys: false,
        };
        assert_eq!(module, expected);
        assert!(log.msgs.is_empty());
    }
}

#[test]
fn invalid_json_fails() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let file = SourceFile {
        path: b"/project/broken.json",
        contents: br#"{"a":"#,
        loader: Loader::Json,
    };
    let mut log = Log::init();
    let result = WithoutServices.parse_data(&file, session.arena(), &atoms, &mut log);
    assert!(result.is_err());
    assert_eq!((log.msgs.len(), log.errors), (1, 1));
    assert_eq!(
        &*log.msgs[0].data.text,
        b"\"/project/broken.json\" is not valid JSON"
    );
}

#[test]
fn other_loaders_are_unsupported() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let loaders: [(Loader, &[u8]); 4] = [
        (Loader::Toml, b"the \"toml\" loader"),
        (Loader::SqliteEmbedded, b"the \"sqlite_embedded\" loader"),
        (Loader::Html, b"the \"html\" loader"),
        (Loader::Tsx, b"the \"tsx\" loader"),
    ];
    for (loader, feature) in loaders {
        let file = SourceFile {
            path: b"/project/a",
            contents: b"a = 1",
            loader,
        };
        let mut log = Log::init();
        let result = WithoutServices.parse_data(&file, session.arena(), &atoms, &mut log);
        assert!(result.is_err());
        assert_unsupported(&log, feature);
    }
}

#[test]
fn macros_are_unsupported() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let call = MacroCall {
        importer: b"/project/a.ts",
        macro_path: b"/project/macro.ts",
        export_name: b"value",
        arguments: &[],
    };
    let mut log = Log::init();
    let result = WithoutServices.run_macro(&call, session.arena(), &atoms, &mut log);
    assert!(result.is_err());
    assert_unsupported(&log, b"macros");
}

#[test]
fn no_pages_need_no_bundler() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let mut log = Log::init();
    let manifests = WithoutServices
        .bundle_pages(&[], session.arena(), &atoms, &mut log)
        .unwrap();
    assert!(manifests.is_empty());
    assert!(log.msgs.is_empty());
}

#[test]
fn pages_need_the_bundler() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let pages: [&[u8]; 1] = [b"/project/index.html"];
    let mut log = Log::init();
    let result = WithoutServices.bundle_pages(&pages, session.arena(), &atoms, &mut log);
    assert!(result.is_err());
    assert_unsupported(&log, b"HTML pages");
}

#[test]
fn embedded_files_are_always_distinct() {
    let mut log = Log::init();
    assert!(WithoutServices.check_embedded_files(&mut log).is_ok());
    assert!(log.msgs.is_empty());
}

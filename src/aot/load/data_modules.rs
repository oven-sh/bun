use crate::diagnostics::LoadMessages;
use crate::load::source_provider::{SourceFile, SourceProvider};
use bun_ast::Loader;
use bun_sema::atom::{Atom, Interner};
use bun_sema::check::spans::skip_trivia;
use bun_sema::hir::{ExprId, ExprKind, File, IdList, PropId, PropKind, Span, StmtKind, UnOp};
use bun_sema::hir_from_data::{DataModule, DataModuleTree, DataValue, HostValue, module_from_data};
use bun_sema::session::Arena;
use bun_sema::util::FxHashMap;
use bun_sema_parser::summarize;
use std::collections::hash_map::Entry;

pub(crate) struct ParsedDataModule<'s> {
    pub hir: File<'s>,
    pub host_values: &'s [(ExprId, HostValue<'s>)],
    pub web_assembly: Option<Vec<u8>>,
    pub is_page: bool,
}

pub(crate) fn parse_data_module<'s>(
    provider: &dyn SourceProvider,
    messages: &LoadMessages,
    source: &SourceFile<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> ParsedDataModule<'s> {
    let module = messages.with_log(|log| provider.parse_data(source, arena, atoms, log));
    let in_place_of_failed = DataModule::Value {
        default: &DataValue::Undefined,
        exports_keys: false,
    };
    let DataModuleTree { file, host_values } =
        module_from_data(module.as_ref().unwrap_or(&in_place_of_failed), atoms, arena);
    let is_web_assembly = module.is_ok() && source.loader == Loader::Wasm;
    ParsedDataModule {
        hir: file,
        host_values,
        web_assembly: is_web_assembly.then(|| source.contents.to_vec()),
        is_page: matches!(module, Ok(DataModule::Page)),
    }
}

pub(crate) fn parse_json<'s>(
    text: &[u8],
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Option<&'s DataValue<'s>> {
    if skip_trivia(text, 0) == text.len() {
        return None;
    }
    let hir = summarize(arena, b"/value.json", None, text, atoms, false, false);
    if hir.has_errors || hir.has_parse_diagnostics {
        return None;
    }
    Some(arena.alloc(compute_json_value(&hir, arena)?))
}

fn compute_json_value<'s>(hir: &File<'_>, arena: &'s Arena) -> Option<DataValue<'s>> {
    let root = hir.ids(hir.body).find_map(|statement| {
        if let StmtKind::ExportAssign(value) | StmtKind::Expr(value) = hir[statement].kind {
            Some(value)
        } else {
            None
        }
    })?;
    let mut values: Vec<Option<DataValue<'s>>> = Vec::with_capacity(hir.exprs.len());
    for expr in hir.exprs.iter() {
        let value = match expr.kind {
            ExprKind::Null => Some(DataValue::Null),
            ExprKind::True => Some(DataValue::Boolean(true)),
            ExprKind::False => Some(DataValue::Boolean(false)),
            ExprKind::Number(index) => Some(DataValue::Number(hir.numbers[index as usize])),
            ExprKind::String(text) => Some(DataValue::String(text)),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => match computed_value(&values, operand) {
                Some(DataValue::Number(number)) => Some(DataValue::Number(-number)),
                _ => None,
            },
            ExprKind::Array(items) => collect_array_items(hir, items, &values, arena),
            ExprKind::Object(props) => collect_object_entries(hir, props, &values, arena),
            ExprKind::Unary {
                op:
                    UnOp::Plus
                    | UnOp::BitNot
                    | UnOp::Not
                    | UnOp::Typeof
                    | UnOp::Void
                    | UnOp::Delete
                    | UnOp::PreInc
                    | UnOp::PreDec
                    | UnOp::PostInc
                    | UnOp::PostDec,
                ..
            }
            | ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => None,
        };
        values.push(value);
    }
    computed_value(&values, root)
}

fn computed_value<'s>(values: &[Option<DataValue<'s>>], expr: ExprId) -> Option<DataValue<'s>> {
    *values.get(expr.idx())?
}

fn collect_array_items<'s>(
    hir: &File<'_>,
    items: IdList<ExprId>,
    values: &[Option<DataValue<'s>>],
    arena: &'s Arena,
) -> Option<DataValue<'s>> {
    let mut item_values: Vec<DataValue<'s>> = Vec::with_capacity(items.len());
    for item in hir.ids(items) {
        item_values.push(computed_value(values, item)?);
    }
    Some(DataValue::Array(arena.alloc_slice_copy(&item_values)))
}

fn collect_object_entries<'s>(
    hir: &File<'_>,
    props: Span<PropId>,
    values: &[Option<DataValue<'s>>],
    arena: &'s Arena,
) -> Option<DataValue<'s>> {
    let mut entries: Vec<(Atom, DataValue<'s>)> = Vec::with_capacity(props.len());
    let mut entry_indexes: FxHashMap<Atom, usize> = FxHashMap::default();
    entry_indexes.reserve(props.len());
    for prop in props.iter() {
        let prop = hir[prop];
        if prop.kind != PropKind::Init {
            return None;
        }
        let key = prop.key.name()?;
        let value = computed_value(values, prop.value)?;
        match entry_indexes.entry(key) {
            Entry::Occupied(index) => entries[*index.get()].1 = value,
            Entry::Vacant(index) => {
                index.insert(entries.len());
                entries.push((key, value));
            }
        }
    }
    Some(DataValue::Object(arena.alloc_slice_copy(&entries)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Diagnostics;
    use crate::load::source_provider::{
        DeferredLoad, Failed, LoadRequest, Loaded, Resolution, ResolveRequest, WithoutServices,
    };
    use bstr::BStr;
    use bun_ast::Log;
    use bun_sema::fold::FoldOptions;
    use bun_sema::session::Session;

    const NESTING_DEPTH: usize = 100_000;

    struct EmbeddingProvider;

    impl SourceProvider for EmbeddingProvider {
        fn fold_options<'s>(
            &self,
            arena: &'s Arena,
            atoms: &Interner<'s>,
            log: &mut Log,
        ) -> FoldOptions<'s> {
            WithoutServices.fold_options(arena, atoms, log)
        }

        fn resolve(
            &self,
            request: &ResolveRequest<'_>,
            log: &mut Log,
        ) -> Result<Resolution, Failed> {
            WithoutServices.resolve(request, log)
        }

        fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
            WithoutServices.load(request, log)
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
            let embedded_path = atoms.intern(file.path);
            match file.loader {
                Loader::Wasm => Ok(DataModule::RuntimeRequire {
                    specifier: embedded_path,
                    loader_type: None,
                    member: None,
                }),
                Loader::File => Ok(DataModule::Value {
                    default: arena.alloc(DataValue::String(embedded_path)),
                    exports_keys: false,
                }),
                Loader::Html => Ok(DataModule::Page),
                _ => WithoutServices.parse_data(file, arena, atoms, log),
            }
        }

        fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
            WithoutServices.check_embedded_files(log)
        }
    }

    fn default_export(file: &File<'_>) -> ExprId {
        let statements: Vec<_> = file.ids(file.body).collect();
        let [statement] = statements[..] else {
            panic!("expected one statement, found {}", statements.len());
        };
        let StmtKind::ExportDefault(value) = file[statement].kind else {
            panic!("expected ExportDefault, found {:?}", file[statement].kind);
        };
        value
    }

    fn written_log(messages: &LoadMessages) -> Log {
        let mut diagnostics = Diagnostics::new();
        diagnostics.add_load_messages(messages);
        assert!(!diagnostics.has_internal_errors());
        let mut log = Log::init();
        diagnostics.write_to(&mut log);
        log
    }

    fn nesting_depth(mut value: &DataValue<'_>) -> usize {
        let mut depth = 0;
        while let DataValue::Array(items) = value {
            depth += 1;
            let Some(item) = items.first() else {
                break;
            };
            value = item;
        }
        depth
    }

    #[test]
    fn parses_every_json_value() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let parse = |text: &[u8]| parse_json(text, session.arena(), &atoms).copied();
        assert_eq!(parse(b"null"), Some(DataValue::Null));
        assert_eq!(parse(b"true"), Some(DataValue::Boolean(true)));
        assert_eq!(parse(b"false"), Some(DataValue::Boolean(false)));
        assert_eq!(parse(b"1.5"), Some(DataValue::Number(1.5)));
        assert_eq!(parse(b"-2"), Some(DataValue::Number(-2.0)));
        let actual = parse(b"\"a\\n\"");
        assert_eq!(actual, Some(DataValue::String(atoms.intern(b"a\n"))));
        assert_eq!(parse(b"[]"), Some(DataValue::Array(&[])));
        assert_eq!(parse(b"{}"), Some(DataValue::Object(&[])));
        assert_eq!(
            parse(br#"{"__proto__":[{}]}"#),
            Some(DataValue::Object(&[(
                atoms.intern(b"__proto__"),
                DataValue::Array(&[DataValue::Object(&[])])
            )]))
        );
        let Some(DataValue::Number(zero)) = parse(b"-0") else {
            panic!("expected a number");
        };
        assert!(zero == 0.0 && zero.is_sign_negative());
    }

    #[test]
    fn repeated_key_takes_last_value() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let value = parse_json(br#"{"a":1,"b":2,"a":3}"#, session.arena(), &atoms).unwrap();
        assert_eq!(
            *value,
            DataValue::Object(&[
                (atoms.intern(b"a"), DataValue::Number(3.0)),
                (atoms.intern(b"b"), DataValue::Number(2.0)),
            ])
        );
    }

    #[test]
    fn accepts_comments() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let text = b"// line\n{ /* block */ \"a\": true } // end";
        let value = parse_json(text, session.arena(), &atoms).unwrap();
        let entries = [(atoms.intern(b"a"), DataValue::Boolean(true))];
        assert_eq!(*value, DataValue::Object(&entries));
    }

    #[test]
    fn rejects_other_syntax() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let texts: [&[u8]; 12] = [
            b"",
            b" \n",
            b"// only a comment",
            b"{a: f()}",
            b"{\"a\": f()}",
            b"`x`",
            b"'x'",
            b"(1)",
            b"[1 2]",
            b"[1,,2]",
            b"1 2",
            b"{\"a\":",
        ];
        for text in texts {
            let value = parse_json(text, session.arena(), &atoms);
            assert_eq!(value, None, "{}", BStr::new(text));
        }
    }

    #[test]
    fn deep_nesting_fits_stack() {
        const STACK_SIZE: usize = 4 << 20;
        let parse = || {
            bun_sema_standalone::native::set_stack_size(STACK_SIZE / 2);
            let session = Session::new();
            let atoms = Interner::new_in(&session);
            let text = [vec![b'['; NESTING_DEPTH], vec![b']'; NESTING_DEPTH]].concat();
            if let Some(value) = parse_json(&text, session.arena(), &atoms) {
                assert_eq!(nesting_depth(value), NESTING_DEPTH);
            }
        };
        let thread = std::thread::Builder::new().stack_size(STACK_SIZE);
        thread.spawn(parse).unwrap().join().unwrap();
    }

    #[test]
    fn computes_deep_tree_without_recursion() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let arena = session.arena();
        let mut nested = DataValue::Array(&[]);
        for _ in 1..NESTING_DEPTH {
            nested = DataValue::Array(arena.alloc_slice_copy(&[nested]));
        }
        let module = DataModule::Value {
            default: arena.alloc(nested),
            exports_keys: false,
        };
        let mut hir = module_from_data(&module, &atoms, arena).file;
        let root = default_export(&hir);
        let statement = hir.ids(hir.body).next().unwrap();
        hir[statement].kind = StmtKind::ExportAssign(root);
        let value = compute_json_value(&hir, arena).unwrap();
        assert_eq!(nesting_depth(&value), NESTING_DEPTH);
    }

    #[test]
    fn failed_provider_gives_empty_module() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let messages = LoadMessages::default();
        let source = SourceFile {
            path: b"/project/a.toml",
            contents: b"a = 1",
            loader: Loader::Toml,
        };
        let parsed = parse_data_module(&WithoutServices, &messages, &source, arena, &atoms);
        let default = default_export(&parsed.hir);
        let ExprKind::Unary {
            op: UnOp::Void,
            operand,
        } = parsed.hir[default].kind
        else {
            panic!("expected `void 0`");
        };
        assert!(matches!(parsed.hir[operand].kind, ExprKind::Number(_)));
        let undefined = [(default, HostValue::Data(&DataValue::Undefined))];
        assert_eq!(parsed.host_values, undefined);
        assert!(parsed.web_assembly.is_none());
        assert!(!parsed.is_page);
        assert_eq!(written_log(&messages).errors, 1);
    }

    #[test]
    fn failed_wasm_module_has_no_bytes() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let messages = LoadMessages::default();
        let source = SourceFile {
            path: b"/project/a.wasm",
            contents: b"\0asm",
            loader: Loader::Wasm,
        };
        let parsed = parse_data_module(&WithoutServices, &messages, &source, arena, &atoms);
        assert!(parsed.web_assembly.is_none());
        assert_eq!(written_log(&messages).errors, 1);
    }

    #[test]
    fn only_wasm_loader_returns_bytes() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let messages = LoadMessages::default();
        let parse = |loader| {
            let source = SourceFile {
                path: b"/project/a.wasm",
                contents: b"\0asm",
                loader,
            };
            parse_data_module(&EmbeddingProvider, &messages, &source, arena, &atoms)
        };

        let wasm = parse(Loader::Wasm);
        assert_eq!(wasm.web_assembly.as_deref(), Some(b"\0asm".as_slice()));
        assert!(wasm.hir.text.is_empty());
        assert!(wasm.host_values.is_empty());
        assert!(!wasm.is_page);

        let file = parse(Loader::File);
        assert!(file.web_assembly.is_none());
        assert!(file.hir.text.is_empty());
        let default = default_export(&file.hir);
        assert!(matches!(file.hir[default].kind, ExprKind::String(_)));
        assert!(!file.is_page);

        assert!(written_log(&messages).msgs.is_empty());
    }

    #[test]
    fn page_module_has_a_deferred_default() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let messages = LoadMessages::default();
        let source = SourceFile {
            path: b"/project/index.html",
            contents: b"<html></html>",
            loader: Loader::Html,
        };
        let page = parse_data_module(&EmbeddingProvider, &messages, &source, arena, &atoms);
        assert!(page.is_page);
        let default = default_export(&page.hir);
        assert_eq!(page.host_values, [(default, HostValue::Deferred)]);
        assert!(page.web_assembly.is_none());
        assert!(written_log(&messages).msgs.is_empty());

        let failed = parse_data_module(&WithoutServices, &messages, &source, arena, &atoms);
        assert!(!failed.is_page);
        let default = default_export(&failed.hir);
        let expected = [(default, HostValue::Data(&DataValue::Undefined))];
        assert_eq!(failed.host_values, expected);
        assert_eq!(written_log(&messages).errors, 1);
    }

    #[test]
    fn host_values_come_back_with_the_tree() {
        let session = Session::new();
        let (arena, atoms) = (session.arena(), Interner::new_in(&session));
        let messages = LoadMessages::default();
        let source = SourceFile {
            path: b"/project/a.json",
            contents: br#"{"a":1}"#,
            loader: Loader::Json,
        };
        let parsed = parse_data_module(&WithoutServices, &messages, &source, arena, &atoms);
        let [(root, HostValue::Data(value))] = *parsed.host_values else {
            panic!("expected one value, found {:?}", parsed.host_values);
        };
        assert!(matches!(parsed.hir[root].kind, ExprKind::Object(_)));
        let entries = [(atoms.intern(b"a"), DataValue::Number(1.0))];
        assert_eq!(*value, DataValue::Object(&entries));
        assert!(!parsed.is_page);
        assert!(written_log(&messages).msgs.is_empty());
    }
}

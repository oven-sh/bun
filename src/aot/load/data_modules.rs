use crate::diagnostics::LoadMessages;
use crate::load::source_provider::{Failed, SourceFile, SourceProvider};
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

impl<'s> ParsedDataModule<'s> {
    fn empty(arena: &'s Arena, atoms: &Interner<'s>) -> ParsedDataModule<'s> {
        let DataModuleTree { file, host_values } = empty_module(arena, atoms);
        ParsedDataModule {
            hir: file,
            host_values,
            web_assembly: None,
            is_page: false,
        }
    }
}

pub(crate) fn parse_data_module<'s>(
    provider: &dyn SourceProvider,
    messages: &LoadMessages,
    source: &SourceFile<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> ParsedDataModule<'s> {
    let module = match messages.with_log(|log| provider.parse_data(source, arena, atoms, log)) {
        Ok(module) => module,
        Err(Failed) => return ParsedDataModule::empty(arena, atoms),
    };
    let DataModuleTree { file, host_values } = module_from_data(&module, atoms, arena);
    ParsedDataModule {
        hir: file,
        host_values,
        web_assembly: (source.loader == Loader::Wasm).then(|| source.contents.to_vec()),
        is_page: module == DataModule::Page,
    }
}

pub(crate) fn empty_module<'s>(arena: &'s Arena, atoms: &Interner<'s>) -> DataModuleTree<'s> {
    let module = DataModule::Value {
        default: &DataValue::Undefined,
        exports_keys: false,
    };
    module_from_data(&module, atoms, arena)
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
            } => negate(computed_value(&values, operand)),
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

fn negate(value: Option<DataValue<'_>>) -> Option<DataValue<'_>> {
    match value? {
        DataValue::Number(number) => Some(DataValue::Number(-number)),
        _ => None,
    }
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

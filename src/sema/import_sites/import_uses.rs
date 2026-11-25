use super::statements::value_import_symbols;
use crate::atom::{Atom, known};
use crate::bind::{Binding, Bound, Decl, ImplicitReferenceKind, Parent, SymbolId};
use crate::fold::Decisions;
use crate::hir::{
    Expr, ExprId, ExprKind, File, Flags, ImportEqualsId, ImportId, NodeData, PatKind, TypeNodeKind,
};
use crate::util::{FxHashMap, PositionSet};

pub(super) struct ImportUses {
    pub is_import: PositionSet,
    pub used_live: PositionSet,
    pub used_anywhere: PositionSet,
    read_live: PositionSet,
}

impl ImportUses {
    fn new(symbol_count: usize) -> ImportUses {
        ImportUses {
            is_import: PositionSet::new(symbol_count),
            used_live: PositionSet::new(symbol_count),
            used_anywhere: PositionSet::new(symbol_count),
            read_live: PositionSet::new(symbol_count),
        }
    }

    fn add_use(&mut self, symbol: SymbolId, is_live: bool) {
        if symbol.is_none() || !self.is_import.contains(symbol.idx()) {
            return;
        }
        self.used_anywhere.insert(symbol.idx());
        if is_live {
            self.used_live.insert(symbol.idx());
        }
    }

    pub(super) fn unused_symbols(&self) -> Vec<SymbolId> {
        let imports = self.is_import.iter();
        let unused = imports.filter(|&index| !self.used_live.contains(index));
        unused.map(|index| SymbolId(index as u32)).collect()
    }

    pub(super) fn symbols_used_without_a_read(&self) -> Vec<SymbolId> {
        let used = self.used_live.iter();
        let never_read = used.filter(|&index| !self.read_live.contains(index));
        never_read.map(|index| SymbolId(index as u32)).collect()
    }

    pub(super) fn symbols_used_only_in_dead_code(&self) -> Vec<SymbolId> {
        let used = self.used_anywhere.iter();
        let only_dead = used.filter(|&index| !self.used_live.contains(index));
        only_dead.map(|index| SymbolId(index as u32)).collect()
    }
}

pub(super) fn names_eval(e: &Expr) -> bool {
    matches!(e.kind, ExprKind::Ident(name) if name == known::eval)
}

pub fn find_imports_of_unused_names(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> Vec<ImportId> {
    if hir.exprs.iter().any(names_eval) {
        return Vec::new();
    }
    let uses = compute_import_uses(hir, bound, decisions);
    let imports = (0..hir.imports.len() as u32).map(ImportId);
    imports
        .filter(|&import| {
            let mut symbols = value_import_symbols(hir, bound, import).peekable();
            !hir[import].type_only
                && hir[import].namespace.is_none()
                && symbols.peek().is_some()
                && symbols.all(|symbol| !uses.used_anywhere.contains(symbol.idx()))
        })
        .collect()
}

fn find_import_symbols(hir: &File<'_>, bound: &Bound<'_>, is_import: &mut PositionSet) {
    for index in 0..hir.imports.len() {
        let import = ImportId(index as u32);
        if !hir[import].type_only {
            for symbol in value_import_symbols(hir, bound, import) {
                is_import.insert(symbol.idx());
            }
        }
    }
    for (index, import) in hir.import_equals.iter().enumerate() {
        let decl = Decl::ImportEquals(ImportEqualsId(index as u32));
        let symbol = bound.declared_symbol(decl);
        if symbol.is_some() && !import.flags.contains(Flags::TYPE_ONLY) {
            is_import.insert(symbol.idx());
        }
    }
}

#[derive(Copy, Clone)]
enum AliasEvaluation {
    Never,
    WhenUsed,
    Always,
}

fn alias_evaluation(hir: &File<'_>, bound: &Bound<'_>, alias: ImportEqualsId) -> AliasEvaluation {
    let import = &hir[alias];
    if import.flags.intersects(Flags::TYPE_ONLY | Flags::AMBIENT) {
        return AliasEvaluation::Never;
    }
    match bound.parent_of_stmt(import.stmt) {
        Parent::None => AliasEvaluation::Never,
        Parent::File if !import.flags.contains(Flags::EXPORT) => AliasEvaluation::WhenUsed,
        Parent::Module(namespace) => match bound.makes_namespace_object(hir, namespace) {
            true => AliasEvaluation::Always,
            false => AliasEvaluation::Never,
        },
        _ => AliasEvaluation::Always,
    }
}

fn add_entity_root_uses(hir: &File<'_>, bound: &Bound<'_>, uses: &mut ImportUses) {
    let mut live_aliases = Vec::new();
    for index in 0..hir.import_equals.len() {
        let alias = ImportEqualsId(index as u32);
        let symbol = bound.declared_symbol(Decl::ImportEquals(alias));
        let is_live = match alias_evaluation(hir, bound, alias) {
            AliasEvaluation::Never => continue,
            AliasEvaluation::WhenUsed => symbol.is_none() || uses.used_live.contains(symbol.idx()),
            AliasEvaluation::Always => true,
        };
        if is_live {
            uses.add_use(symbol, true);
        }
        let Binding::Symbol(root) = bound.entity_root_binding(alias) else {
            continue;
        };
        uses.add_use(root, false);
        if is_live {
            live_aliases.push(alias);
        }
    }
    while let Some(alias) = live_aliases.pop() {
        let Binding::Symbol(root) = bound.entity_root_binding(alias) else {
            continue;
        };
        if !uses.is_import.contains(root.idx()) || uses.used_live.contains(root.idx()) {
            continue;
        }
        uses.add_use(root, true);
        for decl in bound.symbol(root).decls {
            if let Decl::ImportEquals(newly_live) = *decl {
                live_aliases.push(newly_live);
            }
        }
    }
}

/// What a function is written with before its body is replaced counts as dead code. Those expressions aren't bound, so
/// a name that the file also declares elsewhere is not a use.
fn add_uses_in_replaced_bodies(hir: &File<'_>, bound: &Bound<'_>, uses: &mut ImportUses) {
    let mut functions = hir.fns.iter();
    if !functions.any(|it| it.flags.contains(Flags::REPLACED_BODY)) {
        return;
    }
    let unused = uses.is_import.iter();
    let unused = unused.filter(|&index| !uses.used_anywhere.contains(index));
    let mut imports: FxHashMap<Atom, SymbolId> = unused
        .map(|index| SymbolId(index as u32))
        .map(|symbol| (bound.symbol(symbol).name, symbol))
        .collect();
    let names_in_patterns = hir.pats.iter().filter_map(|it| match it.kind {
        PatKind::Ident(name) => Some(name),
        _ => None,
    });
    let names_of_functions = hir.fns.iter().map(|it| it.name);
    let names_of_classes = hir.classes.iter().map(|it| it.name);
    let declared = names_of_functions.chain(names_of_classes);
    for name in names_in_patterns.chain(declared) {
        imports.remove(&name);
    }
    let mut operands_of_types: Vec<ExprId> = Vec::new();
    for node in hir.types.iter() {
        if let TypeNodeKind::Typeof { expr, .. } = node.kind {
            let mut operand = expr;
            while let ExprKind::Dot { obj, .. } = hir[operand].kind {
                operand = obj;
            }
            operands_of_types.push(operand);
        }
    }
    operands_of_types.sort_unstable();
    for (e, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
        if let ExprKind::Ident(name) = node.kind
            && let Some(&symbol) = imports.get(&name)
            && bound.parent_of_expr(e) == Parent::None
            && operands_of_types.binary_search(&e).is_err()
        {
            uses.add_use(symbol, false);
        }
    }
}

pub(super) fn compute_import_uses(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
) -> ImportUses {
    let mut uses = ImportUses::new(bound.symbols.len());
    find_import_symbols(hir, bound, &mut uses.is_import);
    if uses.is_import.iter().next().is_none() {
        return uses;
    }
    for index in 0..hir.exprs.len() {
        let e = ExprId(index as u32);
        if bound.is_evaluated_ident(e)
            && !hir.is_in_known_evaluation(hir[e].pos)
            && let Binding::Symbol(symbol) = bound.binding(e)
        {
            let is_live = !decisions.is_dead_expr(e);
            uses.add_use(symbol, is_live);
            if is_live {
                uses.read_live.insert(symbol.idx());
            }
        }
    }
    add_uses_in_replaced_bodies(hir, bound, &mut uses);
    for export in hir.exports.iter() {
        if export.type_only || export.has_module_specifier {
            continue;
        }
        for spec in export.items.iter() {
            if !hir[spec].type_only
                && let Binding::Symbol(symbol) = bound.exported_binding(spec)
            {
                uses.add_use(symbol, true);
            }
        }
    }
    for reference in bound.runtime.implicit_references() {
        let Binding::Symbol(symbol) = reference.binding else {
            continue;
        };
        let is_live = match reference.kind {
            ImplicitReferenceKind::JsxFactory
            | ImplicitReferenceKind::JsxFragment
            | ImplicitReferenceKind::DefinedPath => {
                !matches!(reference.node, NodeData::Expr(e) if decisions.is_dead_expr(e))
            }
            ImplicitReferenceKind::DecoratorMetadata(_) => true,
        };
        uses.add_use(symbol, is_live);
    }
    add_entity_root_uses(hir, bound, &mut uses);
    uses
}

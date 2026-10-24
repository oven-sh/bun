use super::enum_constants::READS_OTHER_FILE_OR_VARIABLE;
use crate::bind::{Bound, ModuleInstanceState, Parent};
use crate::check::Checker;
use crate::check::decl::Evaluated;
use crate::check::errors_enums_names::Location;
use crate::hir::{
    ExprId, ExprKind, File, Flags, FnBody, IdList, Node, NodeData, PatKind, StmtId, StmtKind,
    VarDeclId, VarKind, has_body,
};
use crate::program::FileId;
use crate::types::EnumValue;
use smallvec::SmallVec;

type StatementLists = SmallVec<[IdList<StmtId>; 1]>;

struct Reader {
    statement: StmtId,
    sibling_declaration: Option<VarDeclId>,
}

impl Checker<'_, '_> {
    pub(in crate::check) fn is_const_inlined_by_transpiler(
        &self,
        constant: Option<(FileId, VarDeclId)>,
        used_at: Location,
        initializer: Evaluated,
    ) -> bool {
        let (Some((file, declaration)), Some(value)) = (constant, initializer.value) else {
            return false;
        };
        let reads_outside = initializer.run_time_inputs & READS_OTHER_FILE_OR_VARIABLE != 0;
        if used_at.file() != file || reads_outside {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        self.can_be_const_value(hir, hir[declaration].init, value)
            && is_in_const_values_at(hir, bound, declaration, used_at.node(hir))
    }

    fn can_be_const_value(&self, hir: &File<'_>, initializer: ExprId, value: EnumValue) -> bool {
        let text = match value {
            EnumValue::Number(_) => return true,
            EnumValue::String(text) => text,
        };
        match hir[initializer].kind {
            ExprKind::String(_)
            | ExprKind::Ident(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. } => true,
            ExprKind::Template { exprs } => exprs.is_empty() || self.atoms().bytes(text).is_ascii(),
            _ => false,
        }
    }
}

fn is_in_const_values_at(
    hir: &File<'_>,
    bound: &Bound<'_>,
    declaration: VarDeclId,
    read: Node,
) -> bool {
    if hir[declaration].kind != VarKind::Const || hir.is_ambient(hir.node(declaration)) {
        return false;
    }
    let statement = bound.var_stmt[declaration.idx()];
    let Some(reader) = find_reader(hir, bound, statement, read) else {
        return false;
    };
    if matches!(hir[reader.statement].kind, StmtKind::Enum(_))
        && is_in_same_list(hir, reader.statement, statement)
    {
        return false;
    }
    let list_owner = bound.parent_of_stmt(statement);
    let lists = scope_statement_lists(hir, bound, statement);
    for visited in lists.iter().flat_map(|&list| hir.ids(list)) {
        if visited == statement {
            return is_declared_before_reader(hir, statement, declaration, &reader)
                && !(list_owner == Parent::File && has_export_from(hir));
        }
        if visited == reader.statement || ends_const_local_prefix(hir, bound, visited) {
            return false;
        }
    }
    false
}

fn find_reader(
    hir: &File<'_>,
    bound: &Bound<'_>,
    const_statement: StmtId,
    read: Node,
) -> Option<Reader> {
    let mut sibling_declaration = None;
    let mut node = read;
    while node.is_some() {
        let data = hir.data(node);
        if let NodeData::VarDecl(declaration) = data
            && bound.var_stmt[declaration.idx()] == const_statement
        {
            sibling_declaration = Some(declaration);
        }
        if let NodeData::Stmt(statement) = data
            && is_in_same_scope(bound, statement, const_statement)
        {
            return Some(Reader {
                statement,
                sibling_declaration,
            });
        }
        node = hir.parent(node);
    }
    None
}

fn is_in_same_scope(bound: &Bound<'_>, first: StmtId, second: StmtId) -> bool {
    bound.parent_of_stmt(first) == bound.parent_of_stmt(second)
}

fn is_in_same_list(hir: &File<'_>, first: StmtId, second: StmtId) -> bool {
    hir.parent(hir.node(first)) == hir.parent(hir.node(second))
}

fn scope_statement_lists(hir: &File<'_>, bound: &Bound<'_>, statement: StmtId) -> StatementLists {
    let mut lists = StatementLists::new();
    match bound.parent_of_stmt(statement) {
        Parent::File => lists.push(hir.body),
        Parent::Module(module) => lists.push(hir[module].body),
        Parent::FnBody(function) => {
            if let FnBody::Block(body) = hir[function].body {
                lists.push(body);
            }
        }
        Parent::Stmt(parent) => {
            let parent = parent.some().map(|parent| hir[parent].kind);
            if let Some(StmtKind::Block(body)) = parent {
                lists.push(body);
            } else if let Some(StmtKind::Switch { cases, .. }) = parent {
                lists.extend(cases.iter().map(|case| hir[case].body));
            }
        }
        Parent::None
        | Parent::Expr(_)
        | Parent::VarInit(_)
        | Parent::ParamDefault(_)
        | Parent::PatPropDefault(_)
        | Parent::PatElemDefault(_)
        | Parent::Prop(_)
        | Parent::PropKey(_)
        | Parent::PatKey(_)
        | Parent::MemberKey(_)
        | Parent::MethodKey(_)
        | Parent::MemberInit(_)
        | Parent::EnumInit(_)
        | Parent::Case(_)
        | Parent::ClassExtends(_)
        | Parent::ClassDecorator(_)
        | Parent::MemberDecorator(_)
        | Parent::ParamDecorator(_) => {}
    }
    lists
}

fn is_declared_before_reader(
    hir: &File<'_>,
    statement: StmtId,
    declaration: VarDeclId,
    reader: &Reader,
) -> bool {
    let StmtKind::Var(declarations) = hir[statement].kind else {
        return false;
    };
    for sibling in declarations.iter() {
        if Some(sibling) == reader.sibling_declaration {
            return false;
        }
        if sibling == declaration {
            return true;
        }
    }
    false
}

fn ends_const_local_prefix(hir: &File<'_>, bound: &Bound<'_>, statement: StmtId) -> bool {
    match hir[statement].kind {
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Directive { .. }
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::Enum(_)
        | StmtKind::ImportEquals(_) => false,
        StmtKind::Var(declarations) => declarations.iter().any(|declaration| {
            let variable = &hir[declaration];
            variable.kind != VarKind::Const
                && variable.init.is_some()
                && !variable.flags.contains(Flags::AMBIENT)
                && matches!(hir[variable.pat].kind, PatKind::Ident(_))
        }),
        StmtKind::Fn(function) => {
            has_body(&hir[function]) && !hir[function].flags.contains(Flags::AMBIENT)
        }
        StmtKind::Class(class) => !hir[class].flags.contains(Flags::AMBIENT),
        StmtKind::Module(module) => {
            !hir[module].flags.contains(Flags::AMBIENT)
                && match bound.module_instance_state[module.idx()] {
                    ModuleInstanceState::NonInstantiated => false,
                    ModuleInstanceState::Instantiated | ModuleInstanceState::ConstEnumOnly => true,
                }
        }
        StmtKind::Import(import) => !hir.is_type_only_import(import),
        StmtKind::ExportNamed(export) => !hir.is_type_only_export(export),
        StmtKind::ExportStar { type_only, .. } => !type_only,
        _ => true,
    }
}

fn has_export_from(hir: &File<'_>) -> bool {
    hir.ids(hir.body).any(|statement| {
        matches!(hir[statement].kind, StmtKind::ExportNamed(export)
            if hir[export].has_module_specifier && !hir.is_type_only_export(export))
    })
}

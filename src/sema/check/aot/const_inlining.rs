use crate::atom::known;
use crate::bind::{Bound, Parent};
use crate::hir::{File, Flags, FnBody, IdList, PatKind, StmtId, StmtKind, VarKind, has_body};
use crate::util::FxHashMap;
use smallvec::SmallVec;

type StatementLists = SmallVec<[IdList<StmtId>; 1]>;

#[derive(Default)]
pub(crate) struct ConstLocalPrefixes {
    statements: FxHashMap<StmtId, bool>,
}

impl ConstLocalPrefixes {
    pub(crate) fn contains(
        &mut self,
        hir: &File<'_>,
        bound: &Bound<'_>,
        statement: StmtId,
    ) -> bool {
        if let Some(&is_in_prefix) = self.statements.get(&statement) {
            return is_in_prefix;
        }
        let is_at_file_level = bound.parent_of_stmt(statement) == Parent::File;
        let mut is_in_prefix = !(is_at_file_level && has_export_from(hir));
        let lists = scope_statement_lists(hir, bound, statement);
        for visited in lists.iter().flat_map(|&list| hir.ids(list)) {
            is_in_prefix = is_in_prefix && !ends_const_local_prefix(hir, bound, visited);
            self.statements.insert(visited, is_in_prefix);
        }
        *self.statements.entry(statement).or_insert(false)
    }
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
        StmtKind::Module(module) => bound.makes_namespace_object(hir, module),
        StmtKind::Import(import) => {
            !hir.is_type_only_import(import) && hir[import].spec != known::bun_bundle
        }
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

#[cfg(test)]
mod tests;

use core::ops::Range;
use std::mem::take;

use bun_sema::atom::{Atom, Interner};
use bun_sema::check::aot::FunctionRef;
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::FoldedValue;
use bun_sema::hir::{
    self, ExportId, ExprId, ExprKind, Flags, FnId, NodeData, PatKind, StmtId, StmtKind, VarDeclId,
    VarKind,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files};

use crate::builtins::id::RuntimeFunction;
use crate::builtins::table::{self, RuntimeFunctionRole};
use crate::builtins::{DirectiveKind, Intrinsic, Resolved, ResolvedBuiltins};
use crate::diagnostic_codes::Code;
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionRole, FunctionVisibility, RuntimeFunctionEntry,
};
use crate::ir::{DeclaredType, StringId, TypeTable};
use crate::lower::{FileLowering, function};

#[derive(Copy, Clone)]
struct LibrarySource<'a, 's> {
    hir: &'a hir::File<'s>,
    analysis: &'a FileAnalysis<'s>,
    builtins: &'a ResolvedBuiltins,
    atoms: &'a Interner<'s>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Directive {
    Visibility(FunctionVisibility),
    OverriddenName(Atom),
    LinkTimeConstant,
    AlwaysInline,
    Getter,
    Constructor,
    NakedConstructor,
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub(in crate::lower) enum LibraryFunctionForm {
    #[default]
    Method,
    Constructor,
    NakedConstructor,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum LibraryStatement {
    Erased,
    Directive(Directive),
    Function(FnId),
    TopLevelCode,
}

#[derive(Default, PartialEq, Eq, Debug)]
struct PendingDirectives {
    visibility: Option<FunctionVisibility>,
    overridden_name: Option<Atom>,
    is_getter: bool,
    form: LibraryFunctionForm,
    is_link_time_constant: bool,
}

#[derive(PartialEq, Eq, Debug)]
enum LibraryItem {
    Function(FnId, PendingDirectives),
    TopLevelCode(StmtId),
}

#[derive(Copy, Clone)]
enum LibraryFunction {
    RuntimeBuiltin(RuntimeFunction),
    Local,
}

pub(super) fn declare_library_functions(file: &mut FileLowering<'_, '_, '_, '_>) {
    for item in LibrarySource::new(file).library_items() {
        match item {
            LibraryItem::Function(function, directives) => {
                let source = FunctionRef {
                    file: file.file,
                    function,
                };
                if !file.inputs.library_functions.is_left_out(source) {
                    declare_library_function(file, function, &directives);
                }
            }
            LibraryItem::TopLevelCode(statement) => {
                let span = file.span_of(NodeData::Stmt(statement));
                file.diagnostics
                    .report(Code::LibraryFileHasTopLevelCode, span, &[]);
            }
        }
    }
}

pub(super) fn collect_library_functions(
    files: &Files<'_>,
    file: FileId,
    builtins: &ResolvedBuiltins,
) -> Vec<(FnId, Range<u32>)> {
    let source = LibrarySource {
        hir: files.hir(file),
        analysis: files.analysis(file),
        builtins,
        atoms: &files.atoms,
    };
    let hir = source.hir;
    let statements = hir.ids(hir.body).filter(|&statement| {
        !source.analysis.decisions.is_dead_stmt(statement)
    });
    statements
        .filter_map(|statement| match source.classify_library_statement(statement) {
            LibraryStatement::Function(function) => {
                let written_at = hir[statement].loc;
                Some((function, written_at.pos..written_at.end))
            }
            LibraryStatement::Erased
            | LibraryStatement::Directive(_)
            | LibraryStatement::TopLevelCode => None,
        })
        .collect()
}

pub(super) fn collect_link_time_constant_functions(
    files: &Files<'_>,
    file: FileId,
    builtins: &ResolvedBuiltins,
) -> Vec<FnId> {
    let source = LibrarySource {
        hir: files.hir(file),
        analysis: files.analysis(file),
        builtins,
        atoms: &files.atoms,
    };
    let items = source.library_items();
    items
        .filter_map(|item| match item {
            LibraryItem::Function(function, directives) => {
                directives.is_link_time_constant.then_some(function)
            }
            LibraryItem::TopLevelCode(_) => None,
        })
        .collect()
}

fn find_runtime_function(
    file: &FileLowering<'_, '_, '_, '_>,
    export_name: &[u8],
) -> Option<RuntimeFunction> {
    let function = file.inputs.sources.runtime_function(file.file, export_name)?;
    let platforms = table::runtime_function(function)?.platforms;
    platforms
        .contains(file.inputs.options.platform)
        .then_some(function)
}

fn classify_library_function(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> LibraryFunction {
    let func = &file.hir[function];
    if !func.flags.contains(Flags::EXPORT) || func.name.is_none() {
        return LibraryFunction::Local;
    }
    match find_runtime_function(file, file.queries.atom_bytes(func.name)) {
        Some(id) => LibraryFunction::RuntimeBuiltin(id),
        None => LibraryFunction::Local,
    }
}

pub(super) fn library_function_form(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> Option<LibraryFunctionForm> {
    match classify_library_function(file, function) {
        LibraryFunction::RuntimeBuiltin(_) => {}
        LibraryFunction::Local => return None,
    }
    let mut items = LibrarySource::new(file).library_items();
    items.find_map(|item| match item {
        LibraryItem::Function(declared, directives) if declared == function => {
            Some(directives.form)
        }
        LibraryItem::Function(..) | LibraryItem::TopLevelCode(_) => None,
    })
}

fn intern_directive_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    pending: &PendingDirectives,
) -> Option<StringId> {
    if pending.is_getter {
        let name = file.queries.atom_bytes(file.hir[function].name);
        let getter_name = [b"get ".as_slice(), name].concat();
        return Some(file.intern_bytes(&getter_name));
    }
    pending.overridden_name.map(|name| file.intern_atom(name))
}

fn is_declared_without_name(
    file: &FileLowering<'_, '_, '_, '_>,
    pending: &PendingDirectives,
) -> bool {
    let is_empty = |name: Atom| file.queries.atom_bytes(name).is_empty();
    !pending.is_getter && pending.overridden_name.is_some_and(is_empty)
}

fn adjust_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    header: &mut Function,
    function: FnId,
    kind: LibraryFunction,
    pending: &PendingDirectives,
) {
    let id = match kind {
        LibraryFunction::RuntimeBuiltin(id) => id,
        LibraryFunction::Local => {
            header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
            return;
        }
    };
    header.enclosing_runtime_function = Some(id);
    let is_async = header.flags.contains(FunctionFlags::IS_ASYNC);
    match pending.compute_visibility(is_async) {
        FunctionVisibility::Public => {}
        FunctionVisibility::Private | FunctionVisibility::PrivateRecursive => {
            header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
        }
    }
    match pending.form {
        LibraryFunctionForm::Method => header.kind = FunctionKind::Method,
        LibraryFunctionForm::Constructor => {}
        LibraryFunctionForm::NakedConstructor => {
            header.kind = FunctionKind::BaseConstructor;
            header.flags = header.flags.without(FunctionFlags::HAS_THIS)
                | FunctionFlags::HAS_NEW_TARGET
                | FunctionFlags::IS_NAKED_CONSTRUCTOR;
            header.this_type = DeclaredType::untyped();
            header.results = vec![DeclaredType::from_compiler(TypeTable::OBJECT)];
        }
    }
    if is_declared_without_name(file, pending) {
        header.name = None;
        header.flags = header.flags.without(FunctionFlags::HAS_EXPLICIT_NAME);
    } else if let Some(name) = intern_directive_name(file, function, pending) {
        header.name = Some(name);
        header.flags |= FunctionFlags::HAS_EXPLICIT_NAME;
    }
    match table::runtime_function(id).map(|data| data.role) {
        Some(RuntimeFunctionRole::Model) => header.role = FunctionRole::Model,
        Some(
            RuntimeFunctionRole::EngineBuiltin
            | RuntimeFunctionRole::HostBuiltin
            | RuntimeFunctionRole::CompilerFunction,
        )
        | None => {}
    }
}

fn declare_library_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    pending: &PendingDirectives,
) {
    let kind = classify_library_function(file, function);
    let id = function::declare_source_function_with(file, function, &mut |file, header| {
        adjust_header(file, header, function, kind, pending);
    });
    match kind {
        LibraryFunction::RuntimeBuiltin(runtime_function) => {
            let flags = file.function_header(id).flags;
            let is_async = flags.contains(FunctionFlags::IS_ASYNC);
            file.fragment.add_runtime_function(RuntimeFunctionEntry {
                id: runtime_function,
                function: id,
                visibility: pending.compute_visibility(is_async),
            });
        }
        LibraryFunction::Local => {}
    }
}

fn parse_visibility(text: &[u8]) -> Option<FunctionVisibility> {
    let name = core::str::from_utf8(text).ok()?;
    FunctionVisibility::from_name(name)
}

impl PendingDirectives {
    fn add(&mut self, directive: Directive) {
        match directive {
            Directive::Visibility(visibility) => self.visibility = Some(visibility),
            Directive::OverriddenName(name) => self.overridden_name = Some(name),
            Directive::LinkTimeConstant => self.is_link_time_constant = true,
            Directive::AlwaysInline => {}
            Directive::Getter => self.is_getter = true,
            Directive::Constructor => self.form = LibraryFunctionForm::Constructor,
            Directive::NakedConstructor => self.form = LibraryFunctionForm::NakedConstructor,
        }
    }

    fn compute_visibility(&self, is_async: bool) -> FunctionVisibility {
        match self.visibility {
            Some(visibility) => visibility,
            None if self.is_link_time_constant || is_async => FunctionVisibility::Private,
            None => FunctionVisibility::Public,
        }
    }
}

impl<'a, 's> LibrarySource<'a, 's> {
    fn new<'p: 'a>(file: &FileLowering<'a, '_, 'p, 's>) -> LibrarySource<'a, 's> {
        LibrarySource {
            hir: file.hir,
            analysis: &file.compiled.analysis,
            builtins: file.builtins,
            atoms: &file.queries.files().atoms,
        }
    }

    fn library_items(self) -> impl Iterator<Item = LibraryItem> {
        let hir = self.hir;
        let mut pending = PendingDirectives::default();
        hir.ids(hir.body).filter_map(move |statement| {
            if self.analysis.decisions.is_dead_stmt(statement) {
                return None;
            }
            match self.classify_library_statement(statement) {
                LibraryStatement::Erased => None,
                LibraryStatement::Directive(directive) => {
                    pending.add(directive);
                    None
                }
                LibraryStatement::Function(function) => {
                    Some(LibraryItem::Function(function, take(&mut pending)))
                }
                LibraryStatement::TopLevelCode => Some(LibraryItem::TopLevelCode(statement)),
            }
        })
    }

    fn classify_library_statement(&self, statement: StmtId) -> LibraryStatement {
        let hir = self.hir;
        let is_erased = match hir[statement].kind {
            StmtKind::Fn(function) => {
                let func = &hir[function];
                if hir::has_body(func) && !func.flags.contains(Flags::AMBIENT) {
                    return LibraryStatement::Function(function);
                }
                true
            }
            StmtKind::Expr(expression) => {
                return match self.find_directive(expression) {
                    Some(directive) => LibraryStatement::Directive(directive),
                    None => LibraryStatement::TopLevelCode,
                };
            }
            StmtKind::Empty
            | StmtKind::Directive { .. }
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_) => true,
            StmtKind::Import(import) => !self.has_import_site(ImportSiteKind::Import(import)),
            StmtKind::ImportEquals(declaration) => hir[declaration]
                .flags
                .intersects(Flags::AMBIENT | Flags::TYPE_ONLY),
            StmtKind::ExportNamed(export) => self.is_type_only_export(export),
            StmtKind::ExportStar { .. } => {
                !self.has_import_site(ImportSiteKind::ExportStar(statement))
            }
            StmtKind::Var(declarations) => declarations
                .iter()
                .all(|declaration| self.declares_nothing_at_run_time(declaration)),
            StmtKind::Class(class) => hir[class].flags.contains(Flags::AMBIENT),
            StmtKind::Enum(declaration) => hir[declaration]
                .flags
                .intersects(Flags::AMBIENT | Flags::CONST),
            StmtKind::Module(declaration) => hir[declaration].flags.contains(Flags::AMBIENT),
            StmtKind::Debugger
            | StmtKind::Return(_)
            | StmtKind::If { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::Block(_)
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::With { .. } => false,
        };
        if is_erased {
            LibraryStatement::Erased
        } else {
            LibraryStatement::TopLevelCode
        }
    }

    fn declares_nothing_at_run_time(&self, declaration: VarDeclId) -> bool {
        let hir = self.hir;
        let node = &hir[declaration];
        if node.flags.contains(Flags::AMBIENT) {
            return true;
        }
        let is_named_const =
            node.kind == VarKind::Const && matches!(hir[node.pat].kind, PatKind::Ident(_));
        let initializer = self.analysis.decisions.constant(hir, node.init);
        match initializer {
            FoldedValue::Constant(_) => is_named_const,
            FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => false,
        }
    }

    fn has_import_site(&self, kind: ImportSiteKind) -> bool {
        self.analysis.import_site_index(kind).is_some()
    }

    fn is_type_only_export(&self, export: ExportId) -> bool {
        let hir = self.hir;
        let clause = &hir[export];
        !self.has_import_site(ImportSiteKind::ExportFrom(export))
            && (clause.type_only || clause.items.iter().all(|spec| hir[spec].type_only))
    }

    fn find_directive(&self, expression: ExprId) -> Option<Directive> {
        let hir = self.hir;
        let (name, value) = if let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[expression].kind
        {
            (target, Some(value))
        } else {
            (expression, None)
        };
        let Some(Resolved::Intrinsic(Intrinsic::Directive(kind))) = self.builtins.of_expr(name)
        else {
            return None;
        };
        let text = match value {
            Some(value) => {
                let ExprKind::String(text) = hir[value].kind else {
                    return None;
                };
                Some(text)
            }
            None => None,
        };
        match (kind, text) {
            (DirectiveKind::Visibility, Some(text)) => {
                parse_visibility(self.atoms.bytes(text)).map(Directive::Visibility)
            }
            (DirectiveKind::OverriddenName, Some(text)) => Some(Directive::OverriddenName(text)),
            (DirectiveKind::LinkTimeConstant, None) => Some(Directive::LinkTimeConstant),
            (DirectiveKind::AlwaysInline, None) => Some(Directive::AlwaysInline),
            (DirectiveKind::Getter, None) => Some(Directive::Getter),
            (DirectiveKind::Constructor, None) => Some(Directive::Constructor),
            (DirectiveKind::NakedConstructor, None) => Some(Directive::NakedConstructor),
            (DirectiveKind::Visibility | DirectiveKind::OverriddenName, None)
            | (
                DirectiveKind::LinkTimeConstant
                | DirectiveKind::AlwaysInline
                | DirectiveKind::Getter
                | DirectiveKind::Constructor
                | DirectiveKind::NakedConstructor,
                Some(_),
            ) => None,
        }
    }
}

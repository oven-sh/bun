use super::failures::ModuleFailureId;
use super::plan::{ModuleRef, View};
use crate::builtins::BuiltinId;
use crate::ir::generated::{ImportPhase, ModuleRequestKind};
use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::hir::ExprId;
use bun_sema::program::Sym;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct SyntheticExportId(pub u32);

/// `const a = require(K)`, where nothing stores to `a` again: from that statement on `a` stands for the module.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Holder {
    pub symbol: SymbolId,
    /// The call of `require`. None for `import a = require(K)`.
    pub call: ExprId,
    pub view: View,
    /// Something looks at the object itself, and not only at members that are bound.
    pub is_needed_as_value: bool,
    /// `const a = __toESM(require(K))`, `const a = __importStar(require(K))`
    pub copy: Option<CopiedExports>,
}

/// The names of what `require` answers that are read there through the new object of a helper.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ShownNames {
    /// The helper defines a getter of its own for each name.
    Own,
    /// The helper may hand an accessor on as it is, which then runs for the new object.
    OwnWithValue,
    /// And it walks over the names with `for in`.
    OwnEnumerableWithValue,
}

/// What the helper of a bundler or of TypeScript makes of what `require` answers: a new object with a getter for each name that the answer has by then, and with the answer itself under `default` unless the answer has the marker.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CopiedExports {
    /// The call of the helper.
    pub written: ExprId,
    pub shows: ShownNames,
    /// `__importStar`: of an answer that has the marker the helper makes no new object and answers the answer.
    pub passes_marked_answer_on: bool,
    /// Every run of the body of the module passes the call.
    pub runs_once: bool,
    /// To ask the answer whether it has a name runs no code.
    pub is_of_ordinary_object: bool,
    /// The text of the module says that it has the marker, so that `default` is a name like the others.
    pub has_marker: bool,
    /// To list the names of the answer and to ask for its prototype runs no code, and the helper asks the answer for nothing but the marker.
    pub may_hold_answer: bool,
    /// Something looks at the new object itself, or reads a name of which the build cannot say whether the answer had it.
    pub is_looked_at: bool,
    /// The new object would be `this`.
    pub is_called_through: bool,
}

/// `a.default` and `a.n`, where `a` holds such a new object.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AnswerMember {
    pub holder: SymbolId,
    /// `None`: `default`, which may be the answer itself.
    pub name: Option<Atom>,
}

/// The module that a bound member access is written on. A name that stands for a name of another module has its variable there.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AccessedModule {
    pub module: ModuleRef,
    /// The access goes through `import * as ns`, which shows what the module had when it was linked.
    pub is_imported: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ImportBinding {
    Local,
    Unused,
    Unbound,
    Variable(Sym),
    Namespace {
        module: ModuleRef,
        phase: ImportPhase,
    },
    Builtin(BuiltinId),
    /// A property of the object of a built-in module that the program can store to.
    CapturedBuiltin {
        member: BuiltinId,
        export: SyntheticExportId,
    },
    BuiltinMember {
        holder: BuiltinId,
        name: Atom,
    },
    Synthetic(SyntheticExportId),
    NamespaceRead {
        module: ModuleRef,
        name: Atom,
    },
    /// `import d from "./k.cjs"`, where `d` is what the CommonJS module exports as a whole.
    Exports {
        module: ModuleRef,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportBinding {
    Variable(Sym),
    Synthetic(SyntheticExportId),
    Namespace {
        module: ModuleRef,
        phase: ImportPhase,
    },
    Indirect {
        module: ModuleRef,
        name: Atom,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleExport {
    pub name: Atom,
    pub binding: ExportBinding,
    pub is_from_star_export: bool,
    pub can_be_ambiguous: bool,
    /// `false`: imports are bound to the variable, and the object of the module, which nothing looks at, does not show it.
    pub is_read_from_object: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportUse {
    None,
    Bound,
    ReadFromObject,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportLookup {
    Unknown,
    Absent,
    Found(ExportBinding),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SyntheticExport {
    pub module: ModuleRef,
    pub name: Atom,
    pub is_known_member: bool,
}

/// `export { name as export_name } from "specifier"`, or the same in two statements: an import and an export of what it declares.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ExportStatement {
    pub export_name: Atom,
    pub specifier: Atom,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct RequiredName {
    pub module: ModuleRef,
    pub name: Atom,
    /// An import asks for any other name. The error of a link that does not find the name is worded by who asks.
    pub asked_by: Option<ExportStatement>,
}

impl RequiredName {
    pub fn new(module: ModuleRef, name: Atom) -> RequiredName {
        RequiredName {
            module,
            name,
            asked_by: None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleRequest {
    pub target: ModuleRef,
    pub phase: ImportPhase,
    pub is_dynamic_star_export: bool,
    pub kind: ModuleRequestKind,
    /// Behind the request, or behind any site of it, the target has run to its end or lies on a cycle with the module that asks.
    pub completes: bool,
    /// The build put the request in front of those that the module writes.
    pub is_hoisted: bool,
}

impl ModuleRequest {
    pub fn import(target: ModuleRef) -> ModuleRequest {
        ModuleRequest {
            target,
            phase: ImportPhase::Evaluation,
            is_dynamic_star_export: false,
            kind: ModuleRequestKind::Import,
            completes: true,
            is_hoisted: false,
        }
    }

    pub fn hoisted_import(target: ModuleRef) -> ModuleRequest {
        ModuleRequest {
            is_hoisted: true,
            ..ModuleRequest::import(target)
        }
    }

    pub fn require(target: ModuleRef, completes: bool) -> ModuleRequest {
        ModuleRequest {
            kind: ModuleRequestKind::Require,
            completes,
            ..ModuleRequest::import(target)
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SpelledModule {
    pub spelling: Atom,
    pub module: ModuleRef,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Candidates<'g> {
    All,
    /// The specifiers the build resolved, each once. Any other value is resolved at run time.
    Modules(&'g [SpelledModule]),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SiteAnswer<'g> {
    Module(ModuleRef),
    Computed(Candidates<'g>),
    Failed(ModuleFailureId),
    Erased,
}

//! CommonJS modules whose exports are module variables.
//!
//! `exports.name = value` stores a property of an object. Where nobody can tell that object from a set of variables there is none: each
//! name is a module variable, `undefined` until it is stored to, and `require("./m").name`, `const { name } = require("./m")`, `m.name`,
//! `import { name } from "./m"` and `ns.name` read it. A FACT: whatever is not shown to hold leaves the module its object.
//!
//! THE MODULE ITSELF. Every mention of `exports`, `module.exports`, `this` at the top level and a variable that is initialized with one of them and never stored to is `E.name`, read, stored to or called; or only
//! tested (`E && ..`, `!E`); or `Object.defineProperty(E, "__esModule", { value: true })`. `module` is mentioned as `module.exports` alone.
//! No `eval`, no `with`, no `return` at the top level, no name that `Object.prototype` has. Or all it does is `module.exports =
//! require("./other")`: then what it exports is what the other does.
//!
//! `Object.defineProperty(E, "name", { enumerable: true, get: function () { return m.other; } })`, where `m` stands for the exports of a module that keeps them
//! in variables: the name is another name for that variable, whatever `exports.name = void 0` has come before. `__exportStar(require("./other"), E)`, with TypeScript's own
//! text for the helper: every name that the other module is sure to have by then, but for `default` and what `E` has already, is another name for its variable.
//! `module.exports = { a, b: value }`, once, before anything else is done with
//! `module.exports`, in a module that is in no cycle and does not mention `exports`: a store to each name.
//!
//! WHOEVER GETS AT IT. What `require` yields, a variable that is initialized with it and never stored to, `ns` of `import * as ns` and a default
//! import that is `module.exports` are used as `m.name`, read or called, as the source of a pattern of plain keys, or only tested.
//! `m.name(..)` hands `m` to the function as `this`: every value stored under the name is a function that does not look at it.
//! `__importDefault(m)`, `__importStar(m)`, `_interopRequireDefault(m)`, known by what their functions do: `m` itself if the module says it was an ES module, else for
//! the first and the last an object whose `default` is `m`.
//!
//! `await import("./m")` is `ns`.
//!
//! A VARIABLE THAT HOLDS WHAT `require` HAS YIELDED is `undefined`, or in its dead zone, until the declaration has run. No code of the module reads it before that where the
//! declaration stands in the PROLOGUE of a module that is in no cycle: the statements at the start that run no function of the module and hand none to anybody.
//!
//! AN ES MODULE sees the properties as they are when the module has been evaluated, in a bundle as they are when they are read. The
//! two are one where every store runs with the body of the module, every name is stored to whenever that runs, and the module is in
//! no cycle. A module that an ES module imports and for which that is not so keeps its object.
//!
//! A MODULE THAT KEEPS ITS OBJECT still needs no `module` object where `module` is mentioned as `module.exports` alone, which is neither deleted nor called: then
//! `module.exports` is a module variable, and `require` reads it.
//!
//! CYCLES. Whoever gets at a module by a `require` or an `import` that the body of a module runs, and is not in a cycle with it, finds it evaluated to the end: were it still being
//! evaluated, it would have led there. Not so a `require` in a function: whatever calls that, a callback, may be called by the module itself: and then neither the bodies of the
//! modules that such a `require` evaluates, the EXPOSED ones. So what only holds
//! of a module that has been evaluated (another name for a variable, `module.exports = ..` once, what an ES module sees) holds for all who are not in its cycle, and the module keeps
//! its object only if one that is gets at it, or an exposed one, or a function requires it.
//!
//! `module.exports = require("./other")` as the only statement of a file: the file IS the other one, as a bundle has it, whoever gets at it and whenever.
//!
//! ONE VALUE. `module.exports = f`, once, with the body: a `require` that finds the module evaluated to the end yields a closure of `f`, and nothing else.
//!
//! It goes by the trees, the symbols and what the bundler has resolved: every task finds the same.

use super::callees::Callee;
use super::flows::Place;
use crate::atom::{Atom, known};
use crate::bind::{Decl, Parent, PatParent, SymFlags, is_module_exports, is_module_exports_inside_parentheses, required_specifier, string_literal_text};
use crate::check::Checker;
use crate::hir::{BinOp, Chain, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, FnKind, ImportEqualsTarget, PatKind, PropKey, PropKind, ResolutionMode, StmtId, StmtKind, UnOp, VarDeclId};
use crate::program::{FileId, Sym};
use crate::util::{FxHashMap, FxHashSet};
use std::sync::OnceLock;

/// How a CommonJS module of the program keeps what it exports.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CommonJsExports {
    /// In what the property `exports` of its `module` object holds.
    Object,
    /// In what `module.exports` holds, which is a module variable: there is no `module` object.
    Value,
    /// In a module variable for each name.
    Variables,
    /// It exports what the other module does, which keeps it in variables.
    Of(FileId),
}

/// An expression that stands for what a module exports, where there is no object for it to yield.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportsMention {
    pub module: FileId,
    /// `ns` of `import * as ns`, whose `default` is not the property of that name.
    pub is_namespace: bool,
    /// `{ default: m }`, as an interop helper makes it for a module that does not say it was an ES module.
    pub is_boxed: bool,
}

impl ExportsMention {
    fn of(module: FileId) -> ExportsMention {
        ExportsMention { module, is_namespace: false, is_boxed: false }
    }
}

/// What TypeScript has emitted for `__exportStar` and `__createBinding` after `(this && this.__name) ||`, without white space.
const EXPORT_STAR: [&[u8]; 2] = [
    b"function(m,exports){for(varpinm)if(p!==\"default\"&&!Object.prototype.hasOwnProperty.call(exports,p))__createBinding(exports,m,p);}",
    b"function(m,exports){for(varpinm)if(p!==\"default\"&&!exports.hasOwnProperty(p))__createBinding(exports,m,p);}",
];
const CREATE_BINDING: [&[u8]; 2] = [
    b"(Object.create?(function(o,m,k,k2){if(k2===undefined)k2=k;vardesc=Object.getOwnPropertyDescriptor(m,k);if(!desc||(\"get\"indesc?!m.__esModule:desc.writable||desc.configurable)){desc={enumerable:true,get:function(){returnm[k];}};}Object.defineProperty(o,k2,desc);}):(function(o,m,k,k2){if(k2===undefined)k2=k;o[k2]=m[k];}))",
    b"(Object.create?(function(o,m,k,k2){if(k2===undefined)k2=k;Object.defineProperty(o,k2,{enumerable:true,get:function(){returnm[k];}});}):(function(o,m,k,k2){if(k2===undefined)k2=k;o[k2]=m[k];}))",
];

const NAMES_OF_OBJECT_PROTOTYPE: [&[u8]; 12] = [
    b"constructor",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
    b"__proto__",
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
];

/// What is for the bundler to say.
struct Graph {
    /// All that are compiled with the program, in their order.
    modules: Vec<FileId>,
    /// By importing file and specifier: the file whose code runs.
    resolved: FxHashMap<(FileId, Atom), FileId>,
    /// The `if` statements whose condition is a constant.
    folded: FxHashMap<(FileId, StmtId), bool>,
    /// Who imports what without saying so: the JSX runtime.
    implicit: Vec<(FileId, FileId)>,
}

/// What has been asked so far. It belongs to a checker.
#[derive(Default)]
pub(super) struct State {
    /// `function_exported_whole`. `None` also while it is being found.
    exported_whole: FxHashMap<FileId, Option<(FileId, FnId, bool)>>,
}

#[derive(Default)]
pub(super) struct Shared {
    graph: OnceLock<Graph>,
    found: OnceLock<Found>,
}

#[derive(Default)]
struct Found {
    exports: FxHashMap<FileId, CommonJsExports>,
    mentions: FxHashMap<(FileId, ExprId), ExportsMention>,
    /// By module and name: the values that are stored. `NONE`: one that is not seen.
    stores: FxHashMap<(FileId, Atom), Vec<ExprId>>,
    /// By module that says it was an ES module: the call that says so.
    marked: FxHashMap<FileId, ExprId>,
    /// By module and name that is another name for a variable: that variable.
    aliases: FxHashMap<(FileId, Atom), (FileId, Atom)>,
    /// The calls of `Object.defineProperty` that say so.
    defining_aliases: FxHashSet<(FileId, ExprId)>,
    /// The calls of `__exportStar` that do.
    stars: FxHashSet<(FileId, ExprId)>,
    /// By module that is in no cycle: where its prologue ends.
    prologues: FxHashMap<FileId, u32>,
    /// `module.exports`, in the modules where that is a variable.
    whole: FxHashSet<(FileId, ExprId)>,
    /// By such a module: the values that are stored to it. `NONE`: one that is not seen.
    values: FxHashMap<FileId, Vec<ExprId>>,
    /// Those of them where that is stored to once, and whenever the body runs to its end.
    stored_once: FxHashSet<FileId>,
    /// The calls of `require` that find their module evaluated to the end.
    finding_evaluated: FxHashSet<(FileId, ExprId)>,
    /// Why a module keeps its object, and how many do for that.
    obstacles: Vec<(&'static str, u32)>,
    /// The same for the `module` object.
    needing_module: Vec<(&'static str, u32)>,
}

/// When an expression is evaluated.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Runs {
    /// It stands in code that the build leaves out.
    Never,
    /// Whenever the body of the module runs to its end.
    Always,
    /// With the body of the module, or not at all.
    Sometimes,
    Later,
}

struct Store {
    value: ExprId,
    runs: Runs,
}

struct Module {
    obstacle: Option<&'static str>,
    /// Why there has to be a `module` object.
    needs_module: Option<&'static str>,
    /// What is stored to `module.exports`.
    values: Vec<ExprId>,
    /// How many of those stores run whenever the body does.
    values_stored_always: u32,
    /// `module.exports = require("./other")` is all there is in the file.
    is_redirect: bool,
    re_exports: Option<FileId>,
    mentions: Vec<ExprId>,
    stores: FxHashMap<Atom, Vec<Store>>,
    methods: Vec<Atom>,
    /// `Object.defineProperty(exports, "__esModule", { value: true })`
    marker: ExprId,
    /// By name: the call that defines a getter, and what the getter returns.
    getters: FxHashMap<Atom, (ExprId, ExprId)>,
    /// `module.exports = { .. }`: the literal.
    literal: ExprId,
    /// The names that the module reads or calls through its own exports.
    reads: FxHashSet<Atom>,
    /// `__exportStar(.., exports)`: the calls, in their order.
    stars: Vec<ExprId>,
    /// What only holds as long as nobody gets at the module while it is evaluated.
    is_exact_outside_cycles: bool,
}

impl Module {
    fn is_marked(&self) -> bool {
        self.marker.is_some()
    }

    fn has(&self, name: Atom) -> bool {
        self.stores.contains_key(&name) || self.getters.contains_key(&name)
    }

    fn is_settled(&self) -> bool {
        self.stores.values().all(|stores| stores.iter().all(|store| store.runs != Runs::Later) && stores.iter().any(|store| store.runs == Runs::Always))
    }
}

enum Use {
    /// `E.name`, `E["name"]`: that expression.
    Member(ExprId, Atom),
    /// Only whether there is a value counts, or not even that.
    Nothing,
    /// It initializes the variable.
    Held(VarDeclId),
    /// `E = value`: the assignment.
    Assigned(ExprId),
    /// `module.exports = E`
    Exported,
    /// `Object.defineProperty(E, "__esModule", { value: true })`: the call.
    Marked(ExprId),
    /// `Object.defineProperty(E, "name", { enumerable: true, get: function () { return value; } })`: the call, the name, `value`.
    Defined(ExprId, Atom, ExprId),
    /// `__importDefault(E)`: the call.
    Interop(ExprId, Helper),
    /// `__exportStar(E, exports)`: the call.
    Starred(ExprId),
    /// `__exportStar(m, E)`: the call.
    StarredInto(ExprId),
    Other(&'static str),
}

/// What a function does with a module that does not say it was an ES module. One that does it hands back.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Helper {
    /// `{ default: mod }`
    Boxes,
    Other,
}

/// What holds the exports of a module under a name.
#[derive(Copy, Clone)]
enum Holder {
    Variable(Sym),
    Import(Decl),
}

enum MemberUse {
    Read,
    Store(ExprId),
    StoreOtherwise,
    Call,
    Delete,
}

#[derive(Default)]
struct Uses {
    mentions: Vec<(FileId, ExprId, ExportsMention)>,
    looked_at: Vec<(FileId, &'static str)>,
    methods: Vec<(FileId, Atom)>,
    /// What a `require` in a function yields.
    required_by_functions: FxHashSet<FileId>,
    finding_evaluated: FxHashSet<(FileId, ExprId)>,
    /// Who does more with which module than evaluate it.
    read_by: FxHashSet<(FileId, FileId)>,
    /// Which ES module imports which module.
    imported_by_es_modules: FxHashSet<(FileId, FileId)>,
    /// Who hands which module to `__exportStar`, by which call.
    starred: Vec<(FileId, ExprId, FileId)>,
    awaited: Vec<FileId>,
}

impl<'p, 's> Checker<'p, 's> {
    /// Once for the program, whichever checker is told, before anything is asked. `modules`: all that are compiled with the program.
    /// `resolved`: by file and specifier, the file whose code an `import`, an `import()` or a `require()` runs. `folded`: the `if` statements at the
    /// top level of CommonJS modules whose condition the build replaces by a constant. `implicit`: who imports which JSX runtime.
    pub fn set_resolved_imports(&self, modules: &[FileId], resolved: Vec<((FileId, Atom), FileId)>, folded: Vec<((FileId, StmtId), bool)>, implicit: Vec<(FileId, FileId)>) {
        self.p.aot.commonjs.graph.get_or_init(|| Graph { modules: modules.to_vec(), resolved: resolved.into_iter().collect(), folded: folded.into_iter().collect(), implicit });
    }

    pub fn commonjs_exports(&mut self, file: FileId) -> CommonJsExports {
        self.commonjs().exports.get(&file).copied().unwrap_or(CommonJsExports::Object)
    }

    /// The module that keeps what `file` exports, if that is in variables.
    pub fn module_with_export_variables(&mut self, file: FileId) -> Option<FileId> {
        let found = self.commonjs();
        let mut at = file;
        loop {
            match found.exports.get(&at)? {
                CommonJsExports::Object | CommonJsExports::Value => return None,
                CommonJsExports::Variables => return Some(at),
                CommonJsExports::Of(other) => at = *other,
            }
        }
    }

    /// What the expression stands for, if that is the exports of a module that has no object for them.
    pub fn exports_mentioned_by(&mut self, file: FileId, e: ExprId) -> Option<ExportsMention> {
        self.commonjs().mentions.get(&(file, e)).copied()
    }

    /// Whether the call is `Object.defineProperty(exports, "__esModule", { value: true })` in a module that has no object for it.
    pub fn marks_export_variables(&mut self, file: FileId, call: ExprId) -> bool {
        self.commonjs().marked.get(&file) == Some(&call)
    }

    /// `e`: `m.name` or `m["name"]`. The module and the name of the variable that it names.
    pub fn export_variable_named_by(&mut self, file: FileId, e: ExprId) -> Option<(FileId, Atom)> {
        let hir = self.hir(file);
        let (obj, name) = match hir[e].kind {
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => (obj, name),
            ExprKind::Index { obj, index, chain: Chain::No } => (obj, string_literal_text(hir, index)),
            _ => return None,
        };
        let mention = self.exports_mentioned_by(file, obj)?;
        if mention.is_namespace {
            return self.export_variable_imported_as(file, mention.module, name);
        }
        if mention.is_boxed {
            return None;
        }
        // `exports.name = void 0`, which the getter replaces.
        if self.bound(file).get_assignment_target(hir, e).is_some() {
            return Some((self.module_with_export_variables(mention.module)?, name));
        }
        self.export_variable_of(mention.module, name)
    }

    /// `e`: a reference to a variable that holds what `require` has yielded for a module without an object. Whether the variable is initialized whenever the reference is evaluated.
    pub fn is_held_whenever_read(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (Some(&prologue), ExprKind::Ident(name)) = (self.commonjs().prologues.get(&file), hir[e].kind) else { return false };
        let Some((of, Decl::Var(pat))) = self.binding_of_identifier(file, e, name).and_then(|sym| self.declaration_of_variable(sym)) else { return false };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return false };
        let end = hir[declaration].loc.end;
        of == file && end <= prologue && self.enclosing_fn(file, Parent::VarInit(declaration)).is_none() && (self.enclosing_fn_of_expr(file, e).is_some() || hir[e].pos >= end)
    }

    /// Whether the call is `__exportStar(require("./other"), exports)` and does no more than evaluate the other module.
    pub fn stars_export_variables(&mut self, file: FileId, call: ExprId) -> bool {
        self.commonjs().stars.contains(&(file, call))
    }

    /// The variable that holds what the module exports under the name, if it keeps that in variables.
    pub fn export_variable_of(&mut self, module: FileId, name: Atom) -> Option<(FileId, Atom)> {
        let keeper = self.module_with_export_variables(module)?;
        Some(self.commonjs().aliases.get(&(keeper, name)).copied().unwrap_or((keeper, name)))
    }

    /// Whether the call is `Object.defineProperty(exports, "name", { get .. })` and does nothing: the name is another name for a variable.
    pub fn defines_alias_of_export_variable(&mut self, file: FileId, call: ExprId) -> bool {
        self.commonjs().defining_aliases.contains(&(file, call))
    }

    /// `module.exports = { a, b: value }` in a module that keeps its exports in variables: the literal.
    pub fn is_literal_of_export_variables(&mut self, file: FileId, literal: ExprId) -> bool {
        matches!(self.hir(file)[literal].kind, ExprKind::Object(_)) && self.commonjs_exports(file) == CommonJsExports::Variables
    }

    /// What the ES module `importer` gets for `import { name } from` the CommonJS module. `None`: there is no variable for it, the module has an
    /// object, or `name` is `default` and stands for all that the module exports.
    pub fn export_variable_imported_as(&mut self, importer: FileId, module: FileId, name: Atom) -> Option<(FileId, Atom)> {
        let keeper = self.module_with_export_variables(module)?;
        (name != known::default || self.has_default_of_its_own(importer, keeper)).then(|| self.commonjs().aliases.get(&(keeper, name)).copied().unwrap_or((keeper, name)))
    }

    /// Whether `default` is the property of that name. Else it is `module.exports`.
    fn has_default_of_its_own(&mut self, importer: FileId, keeper: FileId) -> bool {
        let found = self.commonjs();
        self.files().module(importer).implied_format != ResolutionMode::Import && found.marked.contains_key(&keeper) && (found.stores.contains_key(&(keeper, known::default)) || found.aliases.contains_key(&(keeper, known::default)))
    }

    /// The function that every function the export variable ever holds is a closure of, and whether that is only expected. A read may find `undefined`.
    pub fn only_function_of_export_variable(&mut self, module: FileId, name: Atom) -> Option<(FileId, FnId, bool)> {
        let stores = self.commonjs().stores.get(&(module, name))?;
        let (mut callee, mut is_predicted) = (Callee::Nothing, false);
        for &value in stores {
            if value.is_none() {
                return None;
            }
            let yielded = self.callee_yielded_by(module, value, 0);
            callee = callee.join(yielded.callee);
            is_predicted |= yielded.is_predicted;
        }
        match callee {
            Callee::One(file, func) => Some((file, func, is_predicted)),
            _ => None,
        }
    }

    /// Whether the expression is `module.exports` in a module where that is a variable.
    pub fn is_module_exports_variable(&mut self, file: FileId, e: ExprId) -> bool {
        self.commonjs().whole.contains(&(file, e))
    }

    /// The function that `module.exports` of the module is expected to hold a closure of: every store puts one there. Until the first it holds an object. And whether it is
    /// sure to hold one once the module has been evaluated to the end.
    pub fn function_exported_whole(&mut self, module: FileId) -> Option<(FileId, FnId, bool)> {
        if let Some(&known) = self.aot.commonjs.exported_whole.get(&module) {
            return known;
        }
        self.aot.commonjs.exported_whole.insert(module, None);
        let values = self.commonjs().values.get(&module);
        // Whichever variable is being asked about just now has not come by the variables of this module.
        let mut is_sure = self.commonjs().stored_once.contains(&module);
        let callee = self.apart_from_the_variable_asked_about(|this| {
            values.into_iter().flatten().fold(Callee::Nothing, |callee, &value| {
                if value.is_none() {
                    return callee.join(Callee::Unknown(Place { file: module, pos: 0 }));
                }
                let yielded = this.callee_yielded_by(module, value, 0);
                is_sure &= !yielded.is_predicted && !yielded.may_be_nil;
                callee.join(yielded.callee)
            })
        });
        let found = match callee {
            Callee::One(file, func) => Some((file, func, is_sure)),
            _ => None,
        };
        self.aot.commonjs.exported_whole.insert(module, found);
        found
    }

    /// `e`: `require("./m")`. `function_exported_whole` of the module, and whether the call is sure to yield a closure of it.
    pub(super) fn function_required_by(&mut self, file: FileId, e: ExprId) -> Option<(FileId, FnId, bool)> {
        let hir = self.hir(file);
        let (specifier, ExprKind::Call(call)) = (required_specifier(hir, e)?, hir[e].kind) else { return None };
        let &module = self.p.aot.commonjs.graph.get()?.resolved.get(&(file, specifier))?;
        if self.commonjs_exports(module) != CommonJsExports::Value || !self.names_commonjs_variable(file, hir[call].callee, known::require) {
            return None;
        }
        let finds_it_evaluated = self.commonjs().finding_evaluated.contains(&(file, e));
        self.function_exported_whole(module).map(|(of, func, is_sure)| (of, func, is_sure && finds_it_evaluated))
    }

    /// `--aot-explain=deferred`. Numbers alone.
    pub fn explain_commonjs(&mut self) -> Vec<String> {
        let found = self.commonjs();
        let count = |of: fn(&CommonJsExports) -> bool| found.exports.values().filter(|kept| of(kept)).count();
        let mut lines = vec![format!(
            "commonjs: modules {}: variables {}, re-exports of such {}, module.exports is a variable {} (stored once, with the body: {}), `module` is an object {}; variables {}, other names for them {}; places that stand for exports {}; calls of require that find a module evaluated {}",
            found.exports.len(),
            count(|kept| *kept == CommonJsExports::Variables),
            count(|kept| matches!(kept, CommonJsExports::Of(_))),
            count(|kept| *kept == CommonJsExports::Value),
            found.stored_once.len(),
            count(|kept| *kept == CommonJsExports::Object),
            found.stores.len(),
            found.aliases.len(),
            found.mentions.len(),
            found.finding_evaluated.len()
        )];
        lines.extend(found.obstacles.iter().map(|(why, modules)| format!("commonjs: {}, {modules}: {why}", if why.starts_with("module.exports =") { "one value" } else { "an object" })));
        lines.extend(found.needing_module.iter().map(|(why, modules)| format!("commonjs: `module`, {modules}: {why}")));
        lines
    }

    fn commonjs(&mut self) -> &'p Found {
        let program = self.p;
        if let Some(found) = program.aot.commonjs.found.get() {
            return found;
        }
        program.aot.commonjs.found.get_or_init(|| self.find_commonjs())
    }

    fn find_commonjs(&mut self) -> Found {
        let program = self.p;
        let Some(graph) = program.aot.commonjs.graph.get() else { return Found::default() };
        let mut modules: FxHashMap<FileId, Module> = FxHashMap::default();
        for &file in &graph.modules {
            let module = self.files().module(file);
            if module.is_commonjs() && module.builtin.is_none() && self.hir(file).kind != FileKind::Json {
                let found = self.find_commonjs_module(file, graph);
                modules.insert(file, found);
            }
        }
        for &file in &graph.modules {
            if let Some(other) = modules.get(&file).and_then(|module| module.re_exports)
                && !modules.contains_key(&other)
                && let Some(module) = modules.get_mut(&file)
            {
                module.obstacle = module.obstacle.or(Some("it re-exports what is no CommonJS module"));
            }
        }
        // The module at the end of the re-exports. One that keeps its object for a reason of its own is an end.
        let keeper_of = |modules: &FxHashMap<FileId, Module>, file: FileId| {
            let (mut at, mut steps) = (file, 0);
            while let Some(other) = modules.get(&at).filter(|module| module.obstacle.is_none()).and_then(|module| module.re_exports) {
                steps += 1;
                if steps > modules.len() {
                    break;
                }
                at = other;
            }
            at
        };
        let in_cycles = modules_in_cycles(graph);
        let is_in_cycle_with = |a: FileId, b: FileId| in_cycles.get(&a).is_some_and(|cycle| in_cycles.get(&b) == Some(cycle));
        let exposed = self.modules_exposed(graph);
        let mut uses = Uses::default();
        for &file in &graph.modules {
            self.note_uses_of_commonjs_modules(file, graph, &modules, &keeper_of, &in_cycles, &exposed, &mut uses);
        }
        uses.imported_by_es_modules.extend(graph.implicit.iter().copied());
        // The modules that somebody may get at while they are evaluated.
        let got_at = uses.read_by.iter().copied().chain(uses.imported_by_es_modules.iter().copied());
        let got_at_early: FxHashSet<FileId> = got_at.filter(|&(by, module)| is_in_cycle_with(by, module) || exposed.contains(&by)).map(|(_, module)| module).chain(uses.required_by_functions.iter().copied()).collect();
        let mut with_object: FxHashMap<FileId, &'static str> = FxHashMap::default();
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else { continue };
            if let Some(why) = module.obstacle {
                with_object.entry(file).or_insert(why);
                if let Some(other) = module.re_exports {
                    with_object.entry(keeper_of(&modules, other)).or_insert("a module that keeps its object re-exports it");
                }
            }
            if module.re_exports.is_some() && !module.is_redirect && got_at_early.contains(&file) {
                with_object.entry(keeper_of(&modules, file)).or_insert("what re-exports it may be got at while it is evaluated");
            }
        }
        for &(module, why) in &uses.looked_at {
            with_object.entry(keeper_of(&modules, module)).or_insert(why);
        }
        let standing_for: FxHashMap<(FileId, ExprId), ExportsMention> = uses.mentions.iter().map(|&(file, e, mention)| ((file, e), mention)).collect();
        let mut aliases: FxHashMap<(FileId, Atom), (FileId, Atom)> = FxHashMap::default();
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else { continue };
            if module.literal.is_some() && got_at_early.contains(&file) {
                with_object.entry(file).or_insert("module.exports = { .. }, and it may be got at while it is evaluated");
            }
            let hir = self.hir(file);
            for (&name, &(_, value)) in &module.getters {
                let read = match hir[value].kind {
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } => Some((obj, name)),
                    ExprKind::Index { obj, index, chain: Chain::No } => Some((obj, string_literal_text(hir, index))).filter(|read| read.1.is_some()),
                    _ => None,
                };
                let read = read.filter(|read| self.is_held_once_evaluated(file, graph, read.0));
                match read.and_then(|(obj, other)| Some((standing_for.get(&(file, obj)).filter(|mention| !mention.is_namespace && !mention.is_boxed)?.module, other))) {
                    Some(other) => {
                        aliases.insert((file, name), other);
                    }
                    None => {
                        with_object.entry(file).or_insert("a getter that is no other name for an export");
                    }
                }
            }
        }
        // What a module hands to `__exportStar` it hands to a function, unless that call is seen through.
        let mut stars: FxHashMap<FileId, Vec<(ExprId, FileId)>> = FxHashMap::default();
        for &(file, call, other) in &uses.starred {
            match modules.get(&file).filter(|module| module.obstacle.is_none() && module.stars.contains(&call)) {
                Some(_) => stars.entry(file).or_default().push((call, other)),
                None => {
                    with_object.entry(keeper_of(&modules, other)).or_insert("it is passed to __exportStar, which stores to an object");
                }
            }
        }
        for (&file, starred) in &mut stars {
            let hir = self.hir(file);
            starred.sort_unstable_by_key(|star| hir[star.0].pos);
        }
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else { continue };
            if module.is_exact_outside_cycles && got_at_early.contains(&file) {
                with_object.entry(file).or_insert("a getter or __exportStar, and it may be got at while it is evaluated");
            }
            // What is still being evaluated has not got all its names.
            if stars.get(&file).into_iter().flatten().any(|star| is_in_cycle_with(file, star.1) || is_in_cycle_with(file, keeper_of(&modules, star.1))) {
                with_object.entry(file).or_insert("__exportStar of a module of its cycle");
            }
            if module.stars.len() != stars.get(&file).map_or(0, Vec::len) {
                with_object.entry(file).or_insert("__exportStar of what is no CommonJS module of the program");
            }
        }
        // The names that a module is sure to have, and to show, once it has been evaluated. From the modules without stars on.
        let mut keys: FxHashMap<FileId, Vec<Atom>> = FxHashMap::default();
        loop {
            let before = keys.len();
            for &file in &graph.modules {
                let Some(module) = modules.get(&file).filter(|module| module.re_exports.is_none() && !keys.contains_key(&file)) else { continue };
                let starred = stars.get(&file).map_or(&[][..], |starred| &starred[..]);
                if !starred.iter().all(|star| keys.contains_key(&keeper_of(&modules, star.1))) {
                    continue;
                }
                let hir = self.hir(file);
                let mut own: Vec<Atom> = module.stores.keys().chain(module.getters.keys()).copied().filter(|&name| name != known::__esModule).collect();
                for &(call, other) in starred {
                    for &name in &keys[&keeper_of(&modules, other)] {
                        if name == known::default || aliases.contains_key(&(file, name)) && !module.getters.contains_key(&name) {
                            continue;
                        }
                        // What the module defines itself comes first, or the star is in its way.
                        if module.reads.contains(&name) || module.stores.get(&name).is_some_and(|stores| stores.iter().any(|store| store.runs != Runs::Always)) {
                            with_object.entry(file).or_insert("a name that __exportStar may bring is read by the module itself, or stored to late or not always");
                        }
                        let defined = (module.stores.get(&name).into_iter().flatten().map(|store| store.value)).chain(module.getters.get(&name).map(|getter| getter.0));
                        match defined.map(|e| if e.is_some() { hir[e].pos } else { u32::MAX }).min() {
                            Some(pos) if pos < hir[call].pos => {}
                            Some(_) => {
                                with_object.entry(file).or_insert("a name is defined after __exportStar has");
                            }
                            None => {
                                aliases.insert((file, name), (other, name));
                                own.push(name);
                            }
                        }
                    }
                }
                keys.insert(file, own);
            }
            if keys.len() == before {
                break;
            }
        }
        for &module in &uses.awaited {
            let keeper = keeper_of(&modules, module);
            if modules.get(&keeper).is_some_and(|kept| kept.has(known::then)) || aliases.contains_key(&(keeper, known::then)) {
                with_object.entry(keeper).or_insert("it exports `then`, and an import() of it is awaited");
            }
        }
        for (&file, starred) in &stars {
            let is_sure = |other: FileId| modules.get(&other).is_some_and(|other| other.stores.values().all(|stores| stores.iter().any(|store| store.runs == Runs::Always)));
            if !keys.contains_key(&file) || !starred.iter().all(|star| is_sure(keeper_of(&modules, star.1))) {
                with_object.entry(file).or_insert("__exportStar of a module that may or may not have a name");
            }
        }
        // The variable at the end of the other names. `None`: they go round in a circle.
        let variable_of = |modules: &FxHashMap<FileId, Module>, module: FileId, name: Atom| {
            let (mut module, mut name) = (module, name);
            for _ in 0..64 {
                let keeper = keeper_of(modules, module);
                match aliases.get(&(keeper, name)) {
                    Some(&other) => (module, name) = other,
                    None => return Some((keeper, name)),
                }
            }
            None
        };
        let own_methods: Vec<(FileId, Atom)> = graph.modules.iter().flat_map(|&file| modules.get(&file).into_iter().flat_map(move |module| module.methods.iter().map(move |&name| (file, name)))).collect();
        for &(module, name) in uses.methods.iter().chain(&own_methods) {
            let Some((keeper, stored_as)) = variable_of(&modules, module, name) else { continue };
            let files = self.files();
            let named_by = |file: FileId, member: ExprId| {
                let hir = files.hir(file);
                let (obj, name) = match hir[member].kind {
                    ExprKind::Dot { obj, name, chain: Chain::No, .. } => (obj, name),
                    _ => return None,
                };
                let mention = standing_for.get(&(file, obj)).filter(|mention| !mention.is_namespace && !mention.is_boxed)?;
                let (of, name) = variable_of(&modules, mention.module, name)?;
                Some((of, modules.get(&of)?.stores.get(&name).into_iter().flatten().map(|store| store.value).collect::<Vec<ExprId>>()))
            };
            let values: Vec<ExprId> = modules.get(&keeper).and_then(|module| module.stores.get(&stored_as)).into_iter().flatten().map(|store| store.value).collect();
            if let Some(value) = values.into_iter().find(|&value| value.is_none() || !self.ignores_this(keeper, value, 0, &named_by)) {
                with_object.entry(keeper_of(&modules, module)).or_insert(match value.some().map(|value| self.hir(keeper)[value].kind) {
                    Some(ExprKind::Fn(_)) => "a method call hands it to a function that mentions `this`",
                    Some(ExprKind::Ident(_)) => "a method call hands it to what a name holds, which may look at `this`",
                    Some(ExprKind::Call(_) | ExprKind::New(_)) => "a method call hands it to what a call has yielded, which may look at `this`",
                    Some(ExprKind::Dot { .. } | ExprKind::Index { .. }) => "a method call hands it to a property of something, which may look at `this`",
                    _ => "a method call hands it to a value that may look at `this`",
                });
            }
        }
        let mut imported: Vec<(FileId, FileId)> = uses.imported_by_es_modules.iter().copied().collect();
        imported.sort_unstable();
        for (importer, module) in imported {
            let keeper = keeper_of(&modules, module);
            let Some(kept) = modules.get(&keeper) else { continue };
            let others: Vec<Option<(FileId, Atom)>> = aliases.keys().filter(|alias| alias.0 == keeper).map(|alias| variable_of(&modules, keeper, alias.1)).collect();
            let is_settled = |other: &Option<(FileId, Atom)>| {
                other.is_some_and(|(of, name)| modules.get(&of).is_some_and(|of| of.stores.get(&name).is_none_or(|stores| stores.iter().all(|store| store.runs != Runs::Later) && stores.iter().any(|store| store.runs == Runs::Always))))
            };
            if !kept.is_settled() || !others.iter().all(is_settled) {
                with_object.entry(keeper).or_insert("an ES module imports it, and a name is stored to late or not always");
            } else if is_in_cycle_with(importer, keeper) || is_in_cycle_with(importer, module) || exposed.contains(&importer) || got_at_early.contains(&keeper) && kept.is_exact_outside_cycles {
                with_object.entry(keeper).or_insert("an ES module imports it that may run while it is evaluated");
            }
        }
        // Another name for a variable needs the variable.
        let mut named: Vec<(FileId, Atom)> = aliases.keys().copied().collect();
        named.sort_unstable_by_key(|alias| alias.0);
        loop {
            let before = with_object.len();
            for &(file, name) in &named {
                if variable_of(&modules, file, name).is_none_or(|other| with_object.contains_key(&other.0)) {
                    with_object.entry(file).or_insert("a getter reads from a module that keeps its object");
                }
            }
            for &(file, _, other) in &uses.starred {
                let other = keeper_of(&modules, other);
                match (with_object.contains_key(&file), with_object.contains_key(&other)) {
                    (true, false) => {
                        with_object.insert(other, "it is passed to __exportStar, which stores to an object");
                    }
                    (false, true) => {
                        with_object.insert(file, "__exportStar of a module that keeps its object");
                    }
                    _ => {}
                }
            }
            if with_object.len() == before {
                break;
            }
        }
        let mut found = Found::default();
        let (mut obstacles, mut needing_module): (FxHashMap<&'static str, u32>, FxHashMap<&'static str, u32>) = Default::default();
        for &file in &graph.modules {
            let Some(module) = modules.get(&file) else { continue };
            let keeper = keeper_of(&modules, file);
            if let Some(why) = with_object.get(&file).or_else(|| with_object.get(&keeper)) {
                *obstacles.entry(why).or_default() += 1;
                if let Some(why) = module.needs_module {
                    found.exports.insert(file, CommonJsExports::Object);
                    *needing_module.entry(why).or_default() += 1;
                    continue;
                }
                found.exports.insert(file, CommonJsExports::Value);
                let hir = self.hir(file);
                found.whole.extend(module.mentions.iter().filter(|&&e| !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This)).map(|&e| (file, e)));
                found.values.insert(file, module.values.clone());
                if module.values.len() == 1 && module.values[0].is_some() && module.values_stored_always == 1 {
                    found.stored_once.insert(file);
                }
                continue;
            }
            found.exports.insert(file, module.re_exports.map_or(CommonJsExports::Variables, CommonJsExports::Of));
            found.mentions.extend(module.mentions.iter().map(|&e| ((file, e), ExportsMention::of(file))));
            if module.is_marked() {
                found.marked.insert(file, module.marker);
            }
            for (&name, stores) in &module.stores {
                found.stores.insert((file, name), stores.iter().map(|store| store.value).collect());
            }
            found.defining_aliases.extend(module.getters.values().map(|getter| (file, getter.0)));
            found.stars.extend(module.stars.iter().map(|&call| (file, call)));
        }
        for &(file, name) in &named {
            if !with_object.contains_key(&file) {
                found.aliases.extend(variable_of(&modules, file, name).map(|other| ((file, name), other)));
            }
        }
        found.finding_evaluated = std::mem::take(&mut uses.finding_evaluated);
        for (file, e, mention) in uses.mentions {
            if !with_object.contains_key(&keeper_of(&modules, mention.module)) {
                found.mentions.insert((file, e), mention);
            }
        }
        for &file in &graph.modules {
            if !in_cycles.contains_key(&file) && !got_at_early.contains(&file) && self.files().module(file).is_commonjs() && !self.has_direct_eval(file) {
                let end = self.prologue_of(file, graph);
                found.prologues.insert(file, end);
            }
        }
        found.obstacles = obstacles.into_iter().collect();
        found.obstacles.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        found.needing_module = needing_module.into_iter().collect();
        found.needing_module.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        found
    }

    /// Whether the identifier is `module`, `exports` or `require` as every CommonJS module gets them, not a declaration of the program by that name.
    fn names_commonjs_variable(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let Some(found) = self.binding_of_identifier(file, e, name) else { return true };
        if self.files().flags(found).intersects(SymFlags::MODULE_EXPORTS) || self.files().decls(found).into_iter().any(|(_, decl)| matches!(decl, Decl::CommonJsVariable | Decl::File)) {
            return true;
        }
        if found.file == file && self.files().flags(found).contains(SymFlags::ALIAS) {
            return false;
        }
        self.files().value_declaration(found).is_none_or(|(of, _)| !self.is_compiled(of))
            || self.is_declared_ambient(found)
    }

    fn is_held_once_evaluated(&mut self, file: FileId, graph: &Graph, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(name) = hir[e].kind else { return false };
        let Some((of, Decl::Var(pat))) = self.binding_of_identifier(file, e, name).and_then(|sym| self.declaration_of_variable(sym)) else { return false };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return false };
        of == file && hir[declaration].init.is_some() && self.runs(file, graph, hir[declaration].init) == Runs::Always
    }

    pub fn commonjs_variable_declared_again(&self, file: FileId, name: Atom) -> Option<Sym> {
        if !matches!(name, known::exports | known::module) || !self.files().module(file).is_commonjs() {
            return None;
        }
        let found = self.files().resolve_name(file, crate::bind::ScopeId(0), name, SymFlags::VALUE)?;
        let is_var = found.file == file && self.files().flags(found).contains(SymFlags::FUNCTION_SCOPED_VARIABLE) && self.files().decls(found).into_iter().all(|(_, decl)| matches!(decl, Decl::Var(_)));
        is_var.then_some(found)
    }

    fn runs(&self, file: FileId, graph: &Graph, e: ExprId) -> Runs {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut parent, mut runs, mut from) = (bound.expr_parent[e.idx()], Runs::Always, StmtId::NONE);
        let less = |runs: Runs| if runs == Runs::Always { Runs::Sometimes } else { runs };
        loop {
            parent = match parent {
                Parent::Expr(outer) if outer.is_some() => {
                    if !matches!(hir[outer].kind, ExprKind::Assign { op: None, .. } | ExprKind::Binary { op: BinOp::Comma, .. }) {
                        runs = less(runs);
                    }
                    from = StmtId::NONE;
                    bound.expr_parent[outer.idx()]
                }
                Parent::Stmt(stmt) if stmt.is_some() => {
                    match hir[stmt].kind {
                        StmtKind::Expr(_) | StmtKind::Block(_) | StmtKind::Var(_) => {}
                        StmtKind::If { yes, no, .. } if from.is_some() => match graph.folded.get(&(file, stmt)) {
                            Some(&is_true) if from == if is_true { no } else { yes } => return Runs::Never,
                            Some(_) => {}
                            None => runs = less(runs),
                        },
                        StmtKind::If { .. } => {}
                        _ => runs = less(runs),
                    }
                    from = stmt;
                    bound.stmt_parent[stmt.idx()]
                }
                Parent::VarInit(_) => self.parent_of_node(file, parent),
                Parent::File => return runs,
                Parent::None | Parent::Expr(_) | Parent::Stmt(_) => return Runs::Never,
                _ => {
                    runs = if matches!(parent, Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::MemberInit(_)) { Runs::Later } else { less(runs) };
                    from = StmtId::NONE;
                    self.parent_of_node(file, parent)
                }
            };
        }
    }

    fn use_of_exports(&mut self, file: FileId, e: ExprId) -> Use {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Dot { obj, name, chain: Chain::No, .. } if obj == e => Use::Member(parent, name),
                ExprKind::Index { obj, index, chain: Chain::No } if obj == e => match string_literal_text(hir, index) {
                    name if name.is_some() => Use::Member(parent, name),
                    _ => Use::Other("a computed key"),
                },
                ExprKind::Unary { op: UnOp::Not | UnOp::Void, .. } => Use::Nothing,
                ExprKind::Binary { op: BinOp::And | BinOp::Comma, left, .. } if left == e => Use::Nothing,
                ExprKind::Cond { test, .. } if test == e => Use::Nothing,
                ExprKind::Assign { op: None, target, .. } if target == e => Use::Assigned(parent),
                ExprKind::Assign { op: None, target, value } if value == e && is_module_exports(hir, target) => Use::Exported,
                ExprKind::Call(_) if self.marks_as_es_module(file, parent, e) => Use::Marked(parent),
                ExprKind::Call(call) if hir[call].callee == e => Use::Other("it is called"),
                ExprKind::Call(call) => {
                    if let Some((name, value)) = self.getter_defined_by(file, parent, e) {
                        return Use::Defined(parent, name, value);
                    }
                    if hir[call].args.len() == 2 && hir[call].chain == Chain::No && self.is_export_star(file, hir[call].callee) {
                        return if hir.id_at(hir[call].args, 0) == e { Use::Starred(parent) } else { Use::StarredInto(parent) };
                    }
                    if hir[call].args.len() == 1
                        && hir[call].chain == Chain::No
                        && matches!(hir[e].kind, ExprKind::Call(_))
                        && let Some(helper) = self.interop_helper(file, hir[call].callee)
                    {
                        return Use::Interop(parent, helper);
                    }
                    Use::Other(match hir[hir[call].callee].kind {
                        ExprKind::Dot { obj, name: known::defineProperty, .. } if matches!(hir[obj].kind, ExprKind::Ident(known::Object)) => "it is passed to Object.defineProperty, otherwise than for a marker or a getter",
                        ExprKind::Dot { obj, .. } if matches!(hir[obj].kind, ExprKind::Ident(known::Object)) => "it is passed to another function of Object",
                        ExprKind::Ident(name) | ExprKind::Dot { name, .. } => match self.atoms().bytes(name) {
                            b"__exportStar" => "it is passed to __exportStar",
                            b"__export" | b"__reExport" | b"__toCommonJS" | b"__copyProps" => "it is passed to __export, __reExport, __toCommonJS",
                            b"__createBinding" => "it is passed to __createBinding",
                            b"__importDefault" | b"__importStar" | b"_interopRequireDefault" | b"_interopRequireWildcard" | b"_interop_require_default" | b"_interop_require_wildcard" | b"__toESM" => "it is passed to an interop helper that is not seen through",
                            _ => "it is passed to a function",
                        },
                        _ => "it is passed to a function",
                    })
                }
                ExprKind::Unary { op: UnOp::Typeof, .. } => Use::Other("typeof"),
                ExprKind::Assign { .. } => Use::Other("it is assigned to something"),
                ExprKind::Binary { op: BinOp::Or | BinOp::Nullish | BinOp::And, .. } | ExprKind::Cond { .. } => Use::Other("it is one of two values"),
                ExprKind::Binary { .. } => Use::Other("it is compared, or an operand"),
                ExprKind::New(_) => Use::Other("it is constructed, or passed to a constructor"),
                ExprKind::Dot { .. } | ExprKind::Index { .. } => Use::Other("an optional chain, or it is a key"),
                ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) => Use::Other("it is under an assertion"),
                ExprKind::Array(_) | ExprKind::Spread(_) => Use::Other("it is an element, or is spread"),
                ExprKind::Await(_) => Use::Other("it is awaited"),
                _ => Use::Other("it is used as a value"),
            },
            Parent::Stmt(stmt) => match hir[stmt].kind {
                StmtKind::Expr(_) => Use::Nothing,
                StmtKind::If { test, .. } if test == e => Use::Nothing,
                StmtKind::Return(_) => Use::Other("it is returned"),
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Use::Other("it is exported"),
                _ => Use::Other("it is used as a value"),
            },
            Parent::VarInit(declaration) => Use::Held(declaration),
            Parent::Prop(_) => Use::Other("it is a property of a literal"),
            Parent::FnBody(_) => Use::Other("it is returned"),
            _ => Use::Other("it is used as a value"),
        }
    }

    /// `Object.defineProperty(object, "__esModule", { value: true })`
    fn marks_as_es_module(&mut self, file: FileId, call: ExprId, object: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else { return false };
        let ExprKind::Dot { obj, name: known::defineProperty, chain: Chain::No, .. } = hir[hir[c].callee].kind else { return false };
        let ExprKind::Ident(global @ known::Object) = hir[obj].kind else { return false };
        if hir[c].args.len() != 3 || hir[c].chain != Chain::No || hir.id_at(hir[c].args, 0) != object || !self.names_global(file, obj, global) {
            return false;
        }
        let ExprKind::Object(props) = hir[hir.id_at(hir[c].args, 2)].kind else { return false };
        let mut props = props.iter();
        let (Some(prop), None) = (props.next(), props.next()) else { return false };
        let is_true = match hir[hir[prop].value].kind {
            ExprKind::True => true,
            ExprKind::Unary { op: UnOp::Not, operand } => matches!(hir[operand].kind, ExprKind::Number(number) if hir.numbers[number as usize] == 0.0),
            _ => false,
        };
        string_literal_text(hir, hir.id_at(hir[c].args, 1)) == known::__esModule
            && hir[prop].kind == PropKind::Init
            && matches!(hir[prop].key, PropKey::Name(name) if self.atoms().bytes(name) == b"value")
            && is_true
    }

    /// `Object.defineProperty(object, "name", { enumerable: true, get: function () { return value; } })`: the name and `value`.
    fn getter_defined_by(&mut self, file: FileId, call: ExprId, object: ExprId) -> Option<(Atom, ExprId)> {
        let hir = self.hir(file);
        let ExprKind::Call(c) = hir[call].kind else { return None };
        let ExprKind::Dot { obj, name: known::defineProperty, chain: Chain::No, .. } = hir[hir[c].callee].kind else { return None };
        let ExprKind::Ident(global @ known::Object) = hir[obj].kind else { return None };
        if hir[c].args.len() != 3 || hir[c].chain != Chain::No || hir.id_at(hir[c].args, 0) != object || !self.names_global(file, obj, global) {
            return None;
        }
        let name = Some(string_literal_text(hir, hir.id_at(hir[c].args, 1))).filter(|name| name.is_some())?;
        let ExprKind::Object(props) = hir[hir.id_at(hir[c].args, 2)].kind else { return None };
        let (mut getter, mut is_enumerable) = (None, false);
        for prop in props.iter() {
            let value = hir[prop].value;
            match (hir[prop].kind, hir[prop].key) {
                (PropKind::Init, PropKey::Name(key)) if self.atoms().bytes(key) == b"enumerable" => {
                    is_enumerable = match hir[value].kind {
                        ExprKind::True => true,
                        ExprKind::Unary { op: UnOp::Not, operand } => matches!(hir[operand].kind, ExprKind::Number(number) if hir.numbers[number as usize] == 0.0),
                        _ => false,
                    };
                }
                (PropKind::Init | PropKind::Method, PropKey::Name(known::get)) => match hir[value].kind {
                    ExprKind::Fn(func) => getter = Some(func),
                    _ => return None,
                },
                _ => return None,
            }
        }
        let func = getter.filter(|_| is_enumerable)?;
        if !hir[func].params.is_empty() || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) || hir[func].kind != FnKind::Arrow && self.uses_this(file, func) {
            return None;
        }
        match hir[func].body {
            FnBody::Expr(value) => Some((name, value)),
            FnBody::Block(stmts) if stmts.len() == 1 => match hir[hir.id_at(stmts, 0)].kind {
                StmtKind::Return(value) if value.is_some() => Some((name, value)),
                _ => None,
            },
            _ => None,
        }
    }

    /// What the function that `callee` names does with what `require` has yielded, if it hands back a module that says it was an ES module.
    fn interop_helper(&mut self, file: FileId, callee: ExprId) -> Option<Helper> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(_) = hir[callee].kind else { return None };
        let local = bound.expr_symbol[callee.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        if symbol.decls.len() != 1 || symbol.flags.contains(SymFlags::MERGED) || !bound.assignments_to(local).is_empty() || self.is_stored_through_casts(file, local) {
            return None;
        }
        let func = match symbol.decls[0] {
            Decl::Fn(func) => func,
            Decl::Var(pat) => {
                let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return None };
                let init = hir[declaration].init.some()?;
                match hir[init].kind {
                    ExprKind::Fn(func) => func,
                    // `(this && this.__importDefault) || function (mod) { .. }`, before anything has been stored to `this`, which is `exports`.
                    ExprKind::Binary { op: BinOp::Or, left, right } => {
                        let ExprKind::Binary { op: BinOp::And, left: this, right: own } = hir[left].kind else { return None };
                        let ExprKind::Dot { obj, chain: Chain::No, .. } = hir[own].kind else { return None };
                        let ExprKind::Fn(func) = hir[right].kind else { return None };
                        let is_exports = |e: ExprId| matches!(hir[e].kind, ExprKind::This) && self.this_container(file, e).is_none() && self.enclosing_fn_of_expr(file, e).is_none();
                        if !is_exports(this) || !is_exports(obj) || !self.files().module(file).is_commonjs() || hir[init].end > self.first_effect_of_module(file) {
                            return None;
                        }
                        func
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        let mut params = hir[func].params.iter();
        let (Some(param), None) = (params.next(), params.next()) else { return None };
        let (PatKind::Ident(_), FnBody::Block(stmts)) = (hir[hir[param].pat].kind, hir[func].body) else { return None };
        let module = bound.pat_symbol[hir[param].pat.idx()];
        if hir[param].default.is_some() || !bound.assignments_to(module).is_empty() || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return None;
        }
        let is_module = |e: ExprId| matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == module;
        let is_marked = |e: ExprId| match hir[e].kind {
            ExprKind::Binary { op: BinOp::And, left, right } => is_module(left) && matches!(hir[right].kind, ExprKind::Dot { obj, name: known::__esModule, chain: Chain::No, .. } if is_module(obj)),
            _ => false,
        };
        match hir[hir.ids(stmts).next()?].kind {
            // `return mod && mod.__esModule ? mod : { default: mod };`
            StmtKind::Return(value) if value.is_some() => {
                let ExprKind::Cond { test, yes, no } = hir[value].kind else { return None };
                let ExprKind::Object(props) = hir[no].kind else { return None };
                let mut props = props.iter();
                let (Some(prop), None) = (props.next(), props.next()) else { return None };
                (is_marked(test) && is_module(yes) && hir[prop].kind == PropKind::Init && matches!(hir[prop].key, PropKey::Name(known::default)) && is_module(hir[prop].value)).then_some(Helper::Boxes)
            }
            // `if (mod && mod.__esModule) return mod;`
            StmtKind::If { test, yes, no } if no.is_none() && is_marked(test) => matches!(hir[yes].kind, StmtKind::Return(value) if value.is_some() && is_module(value)).then_some(Helper::Other),
            _ => None,
        }
    }

    /// What follows `(this && this.name) ||` in the initializer of the variable that the identifier names, which is declared once, before the body of the module does
    /// anything, and is never stored to.
    fn text_of_helper(&self, file: FileId, named: ExprId) -> Option<(ExprId, Vec<u8>)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.expr_symbol[named.idx()];
        let symbol = bound.symbols.get(local.idx())?;
        if symbol.decls.len() != 1 || symbol.flags.contains(SymFlags::MERGED) || !bound.assignments_to(local).is_empty() || self.is_stored_through_casts(file, local) {
            return None;
        }
        let Decl::Var(pat) = symbol.decls[0] else { return None };
        let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return None };
        let init = hir[declaration].init.some()?;
        let ExprKind::Binary { op: BinOp::Or, left, right } = hir[init].kind else { return None };
        let ExprKind::Binary { op: BinOp::And, left: this, right: own } = hir[left].kind else { return None };
        let ExprKind::Dot { obj, chain: Chain::No, .. } = hir[own].kind else { return None };
        let is_exports = |e: ExprId| matches!(hir[e].kind, ExprKind::This) && self.this_container(file, e).is_none() && self.enclosing_fn_of_expr(file, e).is_none();
        if !is_exports(this) || !is_exports(obj) || !self.files().module(file).is_commonjs() || hir[declaration].loc.end > self.first_effect_of_module(file) || self.enclosing_fn_of_expr(file, init).is_some() {
            return None;
        }
        // From behind the `||` to the end of the declaration, which takes in the parentheses around it.
        let text = &hir.text[hir[left].end as usize..hir[declaration].loc.end as usize];
        let text: Vec<u8> = text.iter().copied().filter(|byte| !byte.is_ascii_whitespace()).collect();
        let text = text.strip_prefix(b")").unwrap_or(&text).strip_prefix(b"||")?;
        Some((right, text.to_vec()))
    }

    /// Whether the identifier names TypeScript's `__exportStar`.
    fn is_export_star(&mut self, file: FileId, callee: ExprId) -> bool {
        let hir = self.hir(file);
        if !matches!(hir[callee].kind, ExprKind::Ident(_)) {
            return false;
        }
        let Some((function, text)) = self.text_of_helper(file, callee) else { return false };
        if !EXPORT_STAR.contains(&&text[..]) {
            return false;
        }
        let within = hir[function].pos..hir[function].end;
        let binding = self.exprs_by_kind_of(file).of(ExprTag::Ident).iter().copied().find(|&e| within.contains(&hir[e].pos) && matches!(hir[e].kind, ExprKind::Ident(name) if self.atoms().bytes(name) == b"__createBinding"));
        binding.and_then(|binding| self.text_of_helper(file, binding)).is_some_and(|(_, text)| CREATE_BINDING.contains(&&text[..]))
    }

    /// Whether evaluating the expression runs no function of the module and hands none to anybody: it makes functions and literals, reads variables and its own exports, and
    /// chooses among those.
    fn is_inert_in_prologue(&mut self, file: FileId, e: ExprId, depth: u32) -> bool {
        let hir = self.hir(file);
        if depth > 32 {
            return false;
        }
        match hir[e].kind {
            ExprKind::Fn(_) | ExprKind::Ident(_) | ExprKind::This | ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex => true,
            ExprKind::Unary { op: UnOp::Void | UnOp::Not | UnOp::Typeof, operand } => self.is_inert_in_prologue(file, operand, depth + 1),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma | BinOp::EqEqEq | BinOp::NotEqEq, left, right } => self.is_inert_in_prologue(file, left, depth + 1) && self.is_inert_in_prologue(file, right, depth + 1),
            ExprKind::Cond { test, yes, no } => [test, yes, no].into_iter().all(|part| self.is_inert_in_prologue(file, part, depth + 1)),
            // What another module exports, which that module's code may compute: it knows nothing of this one.
            ExprKind::Call(call) if required_specifier(hir, e).is_some() => self.names_commonjs_variable(file, hir[call].callee, known::require),
            ExprKind::Call(call) => {
                let is_literal = |e: ExprId| matches!(hir[e].kind, ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_));
                let callee = hir[call].callee;
                let (is_helper, is_required) = (self.interop_helper(file, callee).is_some() || self.is_export_star(file, callee), self.is_read_from_required(file, callee, depth + 1));
                let defines = matches!(hir[callee].kind, ExprKind::Dot { obj, name: known::defineProperty, chain: Chain::No, .. } if matches!(hir[obj].kind, ExprKind::Ident(global @ known::Object) if self.names_global(file, obj, global)));
                let args: Vec<ExprId> = hir.ids(hir[call].args).collect();
                if is_helper {
                    args.into_iter().all(|arg| self.is_inert_in_prologue(file, arg, depth + 1))
                } else if defines {
                    // The object is the module's own, which has no setters and is no proxy.
                    args.len() == 3 && (matches!(hir[args[0]].kind, ExprKind::Ident(known::exports)) || is_module_exports(hir, args[0])) && is_literal(args[1]) && self.is_inert_in_prologue(file, args[2], depth + 1)
                } else {
                    is_required && args.into_iter().all(is_literal)
                }
            }
            ExprKind::Dot { obj, chain: Chain::No, .. } if matches!(hir[obj].kind, ExprKind::Ident(name @ known::Object) if self.names_global(file, obj, name)) => true,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.is_read_from_required(file, e, depth + 1) || self.is_own_export(file, e) && !self.is_getter_defined_for(file, e),
            ExprKind::Assign { op: None, target, value } => (matches!(hir[target].kind, ExprKind::Ident(_)) && self.bound(file).expr_symbol[target.idx()].is_some() || self.is_own_export(file, target)) && self.is_inert_in_prologue(file, value, depth + 1),
            ExprKind::Object(props) => props.iter().all(|prop| matches!(hir[prop].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method) && matches!(hir[prop].key, PropKey::Name(_)) && self.is_inert_in_prologue(file, hir[prop].value, depth + 1)),
            _ => false,
        }
    }

    /// `exports.name`, `module.exports.name`, `this.name` at the top level
    fn is_own_export(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, chain: Chain::No, .. } = hir[e].kind else { return false };
        match hir[obj].kind {
            ExprKind::Ident(name @ known::exports) => self.names_commonjs_variable(file, obj, name),
            ExprKind::This => true,
            _ => is_module_exports(hir, obj),
        }
    }

    /// `require("m")`, `require("m").a.b`
    fn is_getter_defined_for(&self, file: FileId, member: ExprId) -> bool {
        let (hir, by_kind) = (self.hir(file), self.exprs_by_kind_of(file));
        let ExprKind::Dot { name, .. } = hir[member].kind else { return true };
        by_kind.of(ExprTag::Call).iter().any(|&e| {
            let ExprKind::Call(call) = hir[e].kind else { return false };
            if !matches!(hir[hir[call].callee].kind, ExprKind::Dot { name: known::defineProperty, .. }) || hir[call].args.len() != 3 || self.enclosing_fn_of_expr(file, e).is_some() {
                return false;
            }
            let key = string_literal_text(hir, hir.id_at(hir[call].args, 1));
            let has_no_getter = matches!(hir[hir.id_at(hir[call].args, 2)].kind, ExprKind::Object(props) if props.iter().all(|prop| matches!(hir[prop].kind, PropKind::Init) && !matches!(hir[prop].key, PropKey::Name(known::get) | PropKey::Computed(_))));
            (key.is_none() || key == name) && !has_no_getter
        })
    }

    fn is_read_from_required(&mut self, file: FileId, e: ExprId, depth: u32) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { obj, chain: Chain::No, .. } if depth < 32 => self.is_read_from_required(file, obj, depth + 1),
            ExprKind::Call(call) => required_specifier(hir, e).is_some() && self.names_commonjs_variable(file, hir[call].callee, known::require),
            _ => false,
        }
    }

    /// Where the statements end with which the module starts and that run no function of the module and hand none to anybody.
    fn prologue_of(&mut self, file: FileId, graph: &Graph) -> u32 {
        let hir = self.hir(file);
        let mut end = 0;
        for stmt in hir.ids(hir.body) {
            let is_inert = match hir[stmt].kind {
                StmtKind::Empty | StmtKind::Fn(_) => true,
                StmtKind::Expr(e) => self.is_inert_in_prologue(file, e, 0),
                StmtKind::Var(declarations) => declarations.iter().all(|declaration| {
                    let is_plain = match hir[hir[declaration].pat].kind {
                        PatKind::Ident(_) => true,
                        // `const { a, b: c } = require("m")`
                        PatKind::Object(props) => props.iter().all(|prop| !hir[prop].is_rest && hir[prop].default.is_none() && matches!(hir[prop].key, PropKey::Name(_) | PropKey::None) && matches!(hir[hir[prop].value].kind, PatKind::Ident(_))),
                        _ => false,
                    };
                    is_plain && (hir[declaration].init.is_none() || self.is_inert_in_prologue(file, hir[declaration].init, 0))
                }),
                _ => false,
            };
            if !is_inert || graph.folded.contains_key(&(file, stmt)) {
                break;
            }
            end = hir[stmt].loc.end;
        }
        end
    }

    /// Where the first call, construction, store or deletion stands that the body of the module runs itself.
    fn first_effect_of_module(&self, file: FileId) -> u32 {
        let (hir, by_kind) = (self.hir(file), self.exprs_by_kind_of(file));
        let tags = [ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate, ExprTag::Assign, ExprTag::Unary, ExprTag::ImportCall, ExprTag::Await, ExprTag::Yield];
        let has_effect = |e: ExprId| !matches!(hir[e].kind, ExprKind::Unary { op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof | UnOp::Void, .. });
        let bound = self.bound(file);
        let is_loop_of_the_body = |stmt: &StmtId| matches!(hir[*stmt].kind, StmtKind::ForIn { .. } | StmtKind::ForOf { .. }) && self.enclosing_fn(file, bound.stmt_parent[stmt.idx()]).is_none();
        let first_loop = (0..hir.stmts.len() as u32).map(StmtId).filter(is_loop_of_the_body).map(|stmt| hir[stmt].start).min().unwrap_or(u32::MAX);
        tags.iter().flat_map(|&tag| by_kind.of(tag)).filter(|&&e| has_effect(e) && self.enclosing_fn_of_expr(file, e).is_none()).map(|&e| hir[e].pos).min().unwrap_or(u32::MAX).min(first_loop)
    }

    fn use_of_member(&self, file: FileId, member: ExprId) -> MemberUse {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // An assertion is not there when the program runs.
        let mut asserted = member;
        while let Parent::Expr(parent) = bound.expr_parent[asserted.idx()]
            && matches!(hir[parent].kind, ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_))
        {
            asserted = parent;
        }
        if let Parent::Expr(parent) = bound.expr_parent[asserted.idx()] {
            match hir[parent].kind {
                ExprKind::Assign { op: None, target, value } if target == asserted && bound.get_assignment_target(hir, parent).is_none() => return MemberUse::Store(value),
                ExprKind::Unary { op: UnOp::Delete, .. } => return MemberUse::Delete,
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == asserted => return MemberUse::Call,
                _ => {}
            }
        }
        if bound.get_assignment_target(hir, asserted).is_some() { MemberUse::StoreOtherwise } else { MemberUse::Read }
    }

    fn is_name_of_object_prototype(&self, name: Atom) -> bool {
        NAMES_OF_OBJECT_PROTOTYPE.contains(&self.atoms().bytes(name))
    }

    /// Whether a call of the value does not look at `this`: it is a function that does not mention it, or no function.
    /// `named_by`: for `m.name` that names an export variable: its module and the values that are stored to it.
    fn ignores_this(&mut self, file: FileId, value: ExprId, depth: u32, named_by: &dyn Fn(FileId, ExprId) -> Option<(FileId, Vec<ExprId>)>) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if depth > 16 {
            return false;
        }
        match hir[value].kind {
            ExprKind::Fn(func) => hir[func].kind == FnKind::Arrow || !self.uses_this(file, func),
            ExprKind::Class(_) | ExprKind::Unary { op: UnOp::Void, .. } | ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) => true,
            ExprKind::Assign { op: None, value, .. } => self.ignores_this(file, value, depth + 1, named_by),
            ExprKind::Ident(_) => {
                let local = bound.expr_symbol[value.idx()];
                let Some(symbol) = bound.symbols.get(local.idx()) else { return false };
                if !bound.assignments_to(local).is_empty() || symbol.flags.contains(SymFlags::MERGED) || self.is_stored_through_casts(file, local) {
                    return false;
                }
                match symbol.decls[..] {
                    [Decl::Fn(func)] => !self.uses_this(file, func),
                    [Decl::Class(_)] => true,
                    // What it is initialized with, or `undefined`.
                    [Decl::Var(pat)] => matches!(bound.pat_parent[pat.idx()], PatParent::Var(declaration) if hir[declaration].init.is_some() && self.ignores_this(file, hir[declaration].init, depth + 1, named_by)),
                    _ => false,
                }
            }
            ExprKind::Dot { .. } => named_by(file, value).is_some_and(|(of, values)| values.into_iter().all(|value| value.is_some() && self.ignores_this(of, value, depth + 1, named_by))),
            _ => false,
        }
    }

    fn find_commonjs_module(&mut self, file: FileId, graph: &Graph) -> Module {
        let (hir, bound, by_kind) = (self.hir(file), self.bound(file), self.exprs_by_kind_of(file));
        let mut module = Module { obstacle: None, needs_module: None, values: Vec::new(), values_stored_always: 0, is_redirect: false, re_exports: None, mentions: Vec::new(), stores: FxHashMap::default(), methods: Vec::new(), marker: ExprId::NONE, getters: FxHashMap::default(), literal: ExprId::NONE, reads: FxHashSet::default(), stars: Vec::new(), is_exact_outside_cycles: false };
        if self.has_direct_eval(file) {
            module.obstacle = Some("eval");
            module.needs_module = module.obstacle;
        }
        if self.commonjs_variable_declared_again(file, known::exports).is_some() {
            module.obstacle = Some("`exports` is declared again");
        }
        if self.commonjs_variable_declared_again(file, known::module).is_some() {
            module.obstacle = Some("`module` is declared again");
            module.needs_module = module.obstacle;
        }
        if !hir.with_bodies.is_empty() {
            module.obstacle = Some("with");
            module.needs_module = module.obstacle;
        }
        if (0..hir.stmts.len() as u32).map(StmtId).any(|stmt| matches!(hir[stmt].kind, StmtKind::Return(_)) && self.enclosing_fn(file, bound.stmt_parent[stmt.idx()]).is_none()) {
            module.obstacle = Some("return at the top level");
        }
        for &e in by_kind.of(ExprTag::Ident) {
            let ExprKind::Ident(name) = hir[e].kind else { continue };
            if name == known::arguments && !bound.is_arguments_object(e) && bound.expr_symbol[e.idx()].is_none() {
                module.obstacle = Some("`arguments` at the top level");
                module.needs_module = module.obstacle;
            }
            if name != known::exports && name != known::module || !self.names_commonjs_variable(file, e, name) || self.runs(file, graph, e) == Runs::Never {
                continue;
            }
            match bound.expr_parent[e.idx()] {
                _ if name == known::exports => module.mentions.push(e),
                Parent::Expr(parent) if is_module_exports_inside_parentheses(hir, parent) => module.mentions.push(parent),
                _ => {
                    module.obstacle = Some("`module` is more than module.exports");
                    module.needs_module = module.obstacle;
                }
            }
        }
        for &e in by_kind.of(ExprTag::This) {
            if self.this_container(file, e).is_none() && self.runs(file, graph, e) != Runs::Never {
                module.mentions.push(e);
            }
        }
        let mut next = 0;
        while next < module.mentions.len() {
            let e = module.mentions[next];
            next += 1;
            if !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This) {
                match bound.expr_parent[e.idx()] {
                    // `module` is `this`.
                    Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Call(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == e) || matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }) => {
                        module.needs_module = Some("module.exports is called or deleted");
                    }
                    Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_)) => module.needs_module = Some("module.exports is called or deleted"),
                    Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Assign { op: None, target, .. } if target == e) && bound.get_assignment_target(hir, parent).is_none() => {
                        if let ExprKind::Assign { value, .. } = hir[parent].kind {
                            module.values.push(value);
                            module.values_stored_always += (self.runs(file, graph, parent) == Runs::Always) as u32;
                        }
                    }
                    _ if bound.get_assignment_target(hir, e).is_some() => module.values.push(ExprId::NONE),
                    _ => {}
                }
            }
            match self.use_of_exports(file, e) {
                Use::Member(member, name) => {
                    if self.is_name_of_object_prototype(name) {
                        module.obstacle = Some("a name of Object.prototype");
                    }
                    let value = match self.use_of_member(file, member) {
                        MemberUse::Read => {
                            module.reads.insert(name);
                            continue;
                        }
                        MemberUse::Call => {
                            module.reads.insert(name);
                            module.methods.push(name);
                            continue;
                        }
                        MemberUse::Delete => {
                            module.obstacle = Some("delete exports.name");
                            continue;
                        }
                        MemberUse::Store(value) => value,
                        MemberUse::StoreOtherwise => ExprId::NONE,
                    };
                    let runs = self.runs(file, graph, member);
                    module.stores.entry(name).or_default().push(Store { value, runs });
                }
                Use::Nothing => {}
                Use::Marked(call) if self.runs(file, graph, call) == Runs::Always && !module.is_marked() && matches!(bound.expr_parent[call.idx()], Parent::Stmt(_)) => {
                    module.marker = call;
                    module.stores.entry(known::__esModule).or_default().push(Store { value: ExprId::NONE, runs: Runs::Always });
                }
                Use::Marked(_) => module.obstacle = Some("__esModule is defined late, or twice"),
                Use::Assigned(assignment) => {
                    let ExprKind::Assign { value, .. } = hir[assignment].kind else { continue };
                    let other = required_specifier(hir, value).and_then(|specifier| graph.resolved.get(&(file, specifier)).copied());
                    let is_statement = matches!(bound.expr_parent[assignment.idx()], Parent::Stmt(_));
                    let is_whole = is_statement && !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This) && self.runs(file, graph, assignment) == Runs::Always;
                    match other {
                        Some(other) if is_whole => {
                            module.re_exports = Some(other);
                            module.is_redirect = hir.ids(hir.body).count() == 1;
                        }
                        None if is_whole && matches!(hir[value].kind, ExprKind::Object(_)) && module.literal.is_none() => module.literal = value,
                        _ if matches!(hir[e].kind, ExprKind::Ident(_)) => module.obstacle = Some("exports = .."),
                        _ if !is_whole => module.obstacle = Some("module.exports = .. in a function, a branch or an expression"),
                        _ => {
                            module.obstacle = Some(match hir[value].kind {
                                ExprKind::Fn(_) => "module.exports = a function",
                                ExprKind::Class(_) => "module.exports = a class",
                                ExprKind::Ident(_) => match bound.symbols.get(bound.expr_symbol[value.idx()].idx()).map(|symbol| &symbol.decls[..]) {
                                    Some([Decl::Fn(_)]) => "module.exports = the name of a function",
                                    Some([Decl::Class(_)]) => "module.exports = the name of a class",
                                    Some(&[Decl::Var(pat)]) => match bound.pat_parent[pat.idx()] {
                                        PatParent::Var(declaration) if hir[declaration].init.is_some() => match hir[hir[declaration].init].kind {
                                            ExprKind::Object(_) => "module.exports = the name of a variable that holds { .. }",
                                            ExprKind::Fn(_) => "module.exports = the name of a variable that holds a function",
                                            ExprKind::Class(_) => "module.exports = the name of a variable that holds a class",
                                            ExprKind::Call(_) | ExprKind::New(_) => "module.exports = the name of a variable that holds what a call yields",
                                            _ => "module.exports = the name of a variable that holds something else",
                                        },
                                        _ => "module.exports = the name of a variable without an initializer, or of a pattern",
                                    },
                                    _ => "module.exports = another name",
                                },
                                ExprKind::Call(_) if other.is_some() => "module.exports = require(..), twice",
                                ExprKind::Call(_) if required_specifier(hir, value).is_some() => "module.exports = require(..) of what is not compiled",
                                ExprKind::Call(_) => "module.exports = what a call yields",
                                ExprKind::New(_) => "module.exports = new ..",
                                ExprKind::Object(_) => "module.exports = { .. }, twice",
                                ExprKind::Assign { .. } => "module.exports = .. = ..",
                                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if module.mentions.contains(&obj) => "module.exports = exports.name",
                                ExprKind::Dot { obj, .. } if required_specifier(hir, obj).is_some() => "module.exports = require(..).name",
                                ExprKind::Dot { .. } | ExprKind::Index { .. } => "module.exports = a property of something",
                                _ => "module.exports = another expression",
                            })
                        }
                    }
                }
                Use::StarredInto(call) => {
                    if self.runs(file, graph, call) == Runs::Always && matches!(bound.expr_parent[call.idx()], Parent::Stmt(_)) {
                        module.stars.push(call);
                        module.is_exact_outside_cycles = true;
                    } else {
                        module.obstacle = Some("__exportStar is called late");
                    }
                }
                Use::Starred(_) => module.obstacle = Some("it is passed to a function"),
                Use::Defined(call, name, value) => {
                    let is_plain = self.runs(file, graph, call) == Runs::Always && matches!(bound.expr_parent[call.idx()], Parent::Stmt(_)) && !self.is_name_of_object_prototype(name);
                    if !is_plain || module.getters.insert(name, (call, value)).is_some() {
                        module.obstacle = Some("a getter is defined late, or twice");
                    }
                    // Until the getter is defined there is no such property.
                    module.is_exact_outside_cycles = true;
                }
                Use::Interop(..) => module.obstacle = Some("it is passed to a function"),
                // `var utils = exports;`
                Use::Held(declaration) => {
                    let pat = hir[declaration].pat;
                    let local = bound.pat_symbol[pat.idx()];
                    let is_plain = bound.symbols.get(local.idx()).is_some_and(|symbol| symbol.decls.len() == 1 && !symbol.flags.contains(SymFlags::MERGED))
                        && bound.assignments_to(local).is_empty()
                        && !self.is_stored_through_casts(file, local)
                        && hir[declaration].ty.is_none()
                        && !hir[declaration].flags.intersects(Flags::EXPORT | Flags::AMBIENT);
                    match hir[pat].kind {
                        PatKind::Ident(name) if is_plain => {
                            let holder = self.files().sym(file, local);
                            for &reference in by_kind.of(ExprTag::Ident) {
                                if matches!(hir[reference].kind, ExprKind::Ident(named) if named == name) && bound.expr_parent[reference.idx()] != Parent::None && self.binding_of_identifier(file, reference, name) == Some(holder) {
                                    module.mentions.push(reference);
                                }
                            }
                        }
                        _ => module.obstacle = Some("a variable of the module holds it, which is stored to, or a pattern"),
                    }
                }
                Use::Exported => module.obstacle = Some("module.exports or exports is assigned"),
                Use::Other(why) => module.obstacle = Some(why),
            }
        }
        if module.re_exports.is_some() && module.mentions.len() != 1 {
            module.obstacle = Some("module.exports = require(..), and more is done with it");
        }
        if module.getters.keys().any(|name| module.reads.contains(name)) {
            module.obstacle = Some("a name with a getter is read by the module itself");
        }
        // `exports.name = void 0`, before the getter is defined, is seen by nobody once the module has been evaluated.
        let replaced: Vec<Atom> = module.getters.keys().copied().filter(|name| module.stores.contains_key(name)).collect();
        for name in replaced {
            let defined_at = hir[module.getters[&name].0].pos;
            let is_void = |mut value: ExprId| {
                while let Some(ExprKind::Assign { op: None, value: inner, .. }) = value.some().map(|value| hir[value].kind) {
                    value = inner;
                }
                value.is_some() && matches!(hir[value].kind, ExprKind::Unary { op: UnOp::Void, .. }) && hir[value].pos < defined_at
            };
            if module.reads.contains(&name) || !module.stores[&name].iter().all(|store| store.runs == Runs::Always && is_void(store.value)) {
                module.obstacle = Some("a name with a getter is stored to");
            }
            module.stores.remove(&name);
            module.is_exact_outside_cycles = true;
        }
        if let Some(ExprKind::Object(props)) = module.literal.some().map(|literal| hir[literal].kind) {
            let end = hir[module.literal].end;
            let comes_first = module.mentions.iter().all(|&e| !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::This) && (hir[e].end <= hir[module.literal].pos || hir[e].pos >= end || self.runs(file, graph, e) == Runs::Later));
            let before = module.mentions.iter().filter(|&&e| hir[e].pos < hir[module.literal].pos && self.runs(file, graph, e) != Runs::Later).count();
            if !comes_first || before != 1 || !module.getters.is_empty() || module.is_marked() && hir[module.marker].pos < end || module.stores.values().flatten().any(|store| store.runs == Runs::Later) {
                module.obstacle = Some("module.exports = { .. } is not all that defines the exports");
            }
            for prop in props.iter() {
                let value = hir[prop].value;
                let is_plain = match hir[prop].kind {
                    PropKind::Init | PropKind::Shorthand => true,
                    PropKind::Method => matches!(hir[value].kind, ExprKind::Fn(func) if !self.uses_this(file, func)),
                    _ => false,
                };
                match hir[prop].key {
                    PropKey::Name(name) if is_plain && !self.is_name_of_object_prototype(name) && name != known::__esModule => module.stores.entry(name).or_default().push(Store { value, runs: Runs::Always }),
                    _ => module.obstacle = Some("module.exports = { .. } with more than plain names"),
                }
            }
        }
        if let Some(stores) = module.stores.get(&known::__esModule)
            && (stores.len() != 1 || !module.is_marked())
        {
            module.obstacle = Some("__esModule is stored to");
        }
        module
    }

    /// The modules that a `require` in a function evaluates, and all that those evaluate. Their bodies may run while any other module is being evaluated.
    fn modules_exposed(&mut self, graph: &Graph) -> FxHashSet<FileId> {
        let mut pending: Vec<FileId> = Vec::new();
        for &file in &graph.modules {
            let (hir, by_kind) = (self.hir(file), self.exprs_by_kind_of(file));
            for &e in by_kind.of(ExprTag::Call) {
                let (Some(specifier), ExprKind::Call(call)) = (required_specifier(hir, e), hir[e].kind) else { continue };
                if let Some(&module) = graph.resolved.get(&(file, specifier))
                    && self.names_commonjs_variable(file, hir[call].callee, known::require)
                    && self.runs(file, graph, e) == Runs::Later
                {
                    pending.push(module);
                }
            }
        }
        let mut evaluates: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
        for (from, &to) in graph.resolved.iter().map(|(from, to)| (from.0, to)).chain(graph.implicit.iter().map(|import| (import.0, &import.1))) {
            evaluates.entry(from).or_default().push(to);
        }
        let mut exposed = FxHashSet::default();
        while let Some(module) = pending.pop() {
            if exposed.insert(module) {
                pending.extend(evaluates.get(&module).into_iter().flatten());
            }
        }
        exposed
    }

    fn note_uses_of_commonjs_modules(&mut self, file: FileId, graph: &Graph, modules: &FxHashMap<FileId, Module>, keeper_of: &impl Fn(&FxHashMap<FileId, Module>, FileId) -> FileId, in_cycles: &FxHashMap<FileId, u32>, exposed: &FxHashSet<FileId>, uses: &mut Uses) {
        let (hir, bound, by_kind) = (self.hir(file), self.bound(file), self.exprs_by_kind_of(file));
        let commonjs = |specifier: Atom| graph.resolved.get(&(file, specifier)).copied().filter(|module| modules.contains_key(module));
        let mut pending: Vec<(ExprId, ExportsMention)> = Vec::new();
        let mut held: Vec<(Atom, Holder, ExportsMention)> = Vec::new();
        for &e in by_kind.of(ExprTag::Call) {
            let (Some(specifier), ExprKind::Call(call)) = (required_specifier(hir, e), hir[e].kind) else { continue };
            if let Some(module) = commonjs(specifier)
                && self.names_commonjs_variable(file, hir[call].callee, known::require)
                && self.runs(file, graph, e) != Runs::Never
            {
                if self.runs(file, graph, e) == Runs::Later {
                    uses.required_by_functions.insert(module);
                } else if !exposed.contains(&file) && in_cycles.get(&file).is_none_or(|cycle| in_cycles.get(&module) != Some(cycle)) {
                    uses.finding_evaluated.insert((file, e));
                }
                pending.push((e, ExportsMention::of(module)));
            }
        }
        for &e in by_kind.of(ExprTag::ImportCall) {
            if let ExprKind::ImportCall { args } = hir[e].kind
                && let Some(ExprKind::String(specifier)) = hir.ids(args).next().map(|specifier: ExprId| hir[specifier].kind)
                && let Some(module) = commonjs(specifier)
            {
                uses.imported_by_es_modules.insert((file, module));
                match bound.expr_parent[e.idx()] {
                    Parent::Expr(awaited) if matches!(hir[awaited].kind, ExprKind::Await(_)) && hir.ids(args).count() == 1 => {
                        uses.awaited.push(module);
                        pending.push((awaited, ExportsMention { is_namespace: true, ..ExportsMention::of(module) }));
                    }
                    _ => uses.looked_at.push((module, "import() that is not awaited on the spot")),
                }
            }
        }
        let is_node_mode = self.files().module(file).implied_format == ResolutionMode::Import;
        for stmt in hir.ids(hir.body) {
            match hir[stmt].kind {
                StmtKind::Import(import) if !hir[import].type_only => {
                    let Some(module) = commonjs(hir[import].spec) else { continue };
                    uses.imported_by_es_modules.insert((file, module));
                    let kept = &modules[&keeper_of(modules, module)];
                    let has_default_of_its_own = !is_node_mode && kept.is_marked() && kept.has(known::default);
                    let mut bindings = Vec::new();
                    if hir[import].default.is_some() && !has_default_of_its_own {
                        bindings.push((hir[import].default, Decl::ImportDefault(import), false));
                    }
                    if hir[import].namespace.is_some() {
                        bindings.push((hir[import].namespace, Decl::ImportNamespace(import), true));
                    }
                    for spec in hir[import].named.iter() {
                        if !hir[spec].type_only && hir[spec].imported == known::default && !has_default_of_its_own {
                            bindings.push((hir[spec].local, Decl::ImportSpec(spec), false));
                        }
                    }
                    for (name, decl, is_namespace) in bindings {
                        if hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == name)) {
                            uses.looked_at.push((module, "an import of all of it is exported again"));
                            continue;
                        }
                        held.push((name, Holder::Import(decl), ExportsMention { module, is_namespace, is_boxed: false }));
                    }
                }
                StmtKind::ExportNamed(export) if !hir[export].type_only && hir[export].spec.is_some() => {
                    let Some(module) = commonjs(hir[export].spec) else { continue };
                    uses.imported_by_es_modules.insert((file, module));
                    if hir[export].items.iter().any(|item| hir[item].local == known::default) {
                        uses.looked_at.push((module, "export { default } from"));
                    }
                }
                StmtKind::ExportStar { spec, type_only: false, .. } => uses.looked_at.extend(commonjs(spec).map(|module| (module, "export * from"))),
                StmtKind::ImportEquals(import) => {
                    if let ImportEqualsTarget::Require(specifier) = hir[import].target {
                        uses.looked_at.extend(commonjs(specifier).map(|module| (module, "import = require()")));
                    }
                }
                _ => {}
            }
        }
        let mut followed = 0;
        loop {
            while let Some((e, mention)) = pending.pop() {
                uses.mentions.push((file, e, mention));
                let module = mention.module;
                let found = self.use_of_exports(file, e);
                if !matches!(found, Use::Nothing) && !matches!(found, Use::Held(declaration) if matches!(hir[hir[declaration].pat].kind, PatKind::Ident(_))) {
                    uses.read_by.insert((file, module));
                }
                match found {
                    Use::Member(member, name) if mention.is_boxed => match self.use_of_member(file, member) {
                        MemberUse::Read if name == known::default => pending.push((member, ExportsMention::of(module))),
                        _ => uses.looked_at.push((module, "what an interop helper has made is used for more than its default")),
                    },
                    Use::Member(member, name) => {
                        let kept = &modules[&keeper_of(modules, module)];
                        // Where a bundle and the loader differ.
                        if mention.is_namespace && (name == known::__esModule || name == known::default && !kept.is_marked() && kept.has(known::default)) {
                            uses.looked_at.push((module, "ns.__esModule, or ns.default of a module that is not marked and has one"));
                        }
                        if mention.is_namespace && name == known::default && (is_node_mode || !kept.is_marked() || !kept.has(known::default)) {
                            pending.push((member, ExportsMention::of(module)));
                            continue;
                        }
                        if self.is_name_of_object_prototype(name) {
                            uses.looked_at.push((module, "a name of Object.prototype"));
                        }
                        match self.use_of_member(file, member) {
                            MemberUse::Read => {}
                            MemberUse::Call => uses.methods.push((module, name)),
                            _ => uses.looked_at.push((module, "another module stores to it or deletes from it")),
                        }
                    }
                    Use::Nothing => {}
                    Use::Held(declaration) => {
                        let pat = hir[declaration].pat;
                        match hir[pat].kind {
                            PatKind::Ident(name) => {
                                let local = bound.pat_symbol[pat.idx()];
                                let is_plain = !self.has_direct_eval(file)
                                    && bound.symbols.get(local.idx()).is_some_and(|symbol| symbol.decls.len() == 1 && !symbol.flags.contains(SymFlags::MERGED))
                                    && bound.assignments_to(local).is_empty()
                                    && !self.is_stored_through_casts(file, local)
                                    && hir[declaration].ty.is_none()
                                    && !hir[declaration].flags.intersects(Flags::EXPORT | Flags::AMBIENT)
                                    && !hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == name));
                                if is_plain {
                                    held.push((name, Holder::Variable(self.files().sym(file, local)), mention));
                                } else {
                                    uses.looked_at.push((module, "a variable that is stored to, exported or declared twice holds it"));
                                }
                            }
                            PatKind::Object(props) if !mention.is_boxed && hir[declaration].ty.is_none() => {
                                let kept = &modules[&keeper_of(modules, module)];
                                let is_whole = |name: Atom| mention.is_namespace && (name == known::__esModule || name == known::default && (is_node_mode || !kept.is_marked() || !kept.has(known::default)));
                                for prop in props.iter() {
                                    let name = match (hir[prop].key, hir[hir[prop].value].kind) {
                                        _ if hir[prop].is_rest => None,
                                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => Some(name),
                                        _ => None,
                                    };
                                    if name.is_none_or(|name| self.is_name_of_object_prototype(name) || is_whole(name)) {
                                        uses.looked_at.push((module, "a pattern with a rest or a computed key"));
                                    }
                                }
                            }
                            _ => uses.looked_at.push((module, "it is used as a value")),
                        }
                    }
                    Use::Exported if modules.get(&file).is_some_and(|importer| importer.re_exports == Some(module)) => {}
                    Use::Interop(call, helper) => {
                        let keeper = keeper_of(modules, module);
                        let kept = &modules[&keeper];
                        // Whoever requires the module while it is evaluated finds it marked if that is the first thing it does.
                        let may_be_early = in_cycles.get(&keeper).is_some_and(|cycle| in_cycles.get(&file) == Some(cycle)) || exposed.contains(&file) || self.runs(file, graph, call) == Runs::Later;
                        let is_marked_late = kept.is_marked() && may_be_early && self.hir(keeper)[kept.marker].pos > self.first_effect_of_module(keeper);
                        if mention.is_namespace || mention.is_boxed || !kept.is_marked() && helper != Helper::Boxes || is_marked_late {
                            uses.looked_at.push((module, "an interop helper copies it"));
                        } else {
                            pending.push((call, ExportsMention { is_boxed: !kept.is_marked(), ..mention }));
                        }
                    }
                    Use::Starred(call) if !mention.is_namespace && !mention.is_boxed && matches!(hir[e].kind, ExprKind::Call(_)) => uses.starred.push((file, call, module)),
                    Use::Starred(_) | Use::StarredInto(_) => uses.looked_at.push((module, "it is passed to __exportStar, otherwise than as what `require` yields")),
                    Use::Exported | Use::Assigned(_) | Use::Marked(_) | Use::Defined(..) => uses.looked_at.push((module, "it is used as a value")),
                    Use::Other(why) => uses.looked_at.push((module, why)),
                }
            }
            if followed == held.len() {
                break;
            }
            let names = &held[followed..];
            for &e in by_kind.of(ExprTag::Ident) {
                let ExprKind::Ident(name) = hir[e].kind else { continue };
                if !names.iter().any(|binding| binding.0 == name) || bound.expr_parent[e.idx()] == Parent::None || bound.is_in_type_query(e) {
                    continue;
                }
                let Some(found) = self.binding_of_identifier(file, e, name) else { continue };
                let is_held_by = |holder: Holder| match holder {
                    Holder::Variable(sym) => sym == found,
                    Holder::Import(decl) => self.files().decls(found).contains(&(file, decl)),
                };
                if let Some(binding) = names.iter().find(|binding| binding.0 == name && is_held_by(binding.1)) {
                    pending.push((e, binding.2));
                }
            }
            if self.files().jsx_runtime(file).is_none() {
                for &e in by_kind.of(ExprTag::Jsx) {
                    for is_fragment_tag in [false, true] {
                        let (_, Some(found)) = self.classic_jsx_factory(file, e, is_fragment_tag) else { continue };
                        let is_held_by = |holder: Holder| match holder {
                            Holder::Variable(sym) => sym == found,
                            Holder::Import(decl) => self.files().decls(found).contains(&(file, decl)),
                        };
                        for binding in names.iter().filter(|binding| is_held_by(binding.1)) {
                            uses.looked_at.push((binding.2.module, "the classic JSX runtime reads its factory from it"));
                        }
                    }
                }
            }
            followed = held.len();
        }
    }
}

/// The modules that evaluate themselves by way of others, whatever makes one evaluate the next: each with a number that it shares with those others.
fn modules_in_cycles(graph: &Graph) -> FxHashMap<FileId, u32> {
    let mut evaluates: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    let mut evaluated_by: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    let mut in_cycles = FxHashMap::default();
    let mut requiring_themselves = Vec::new();
    let mut edges: Vec<(FileId, FileId)> = graph.resolved.iter().map(|(from, &to)| (from.0, to)).chain(graph.implicit.iter().copied()).collect();
    edges.sort_unstable();
    edges.dedup();
    for (from, to) in edges {
        evaluates.entry(from).or_default().push(to);
        evaluated_by.entry(to).or_default().push(from);
        if from == to {
            requiring_themselves.push(from);
        }
    }
    let (mut left, mut seen) = (Vec::new(), FxHashSet::default());
    for &root in &graph.modules {
        let mut path = if seen.insert(root) { vec![(root, 0)] } else { Vec::new() };
        while let Some(&(module, next)) = path.last() {
            match evaluates.get(&module).and_then(|evaluated| evaluated.get(next)) {
                Some(&evaluated) => {
                    if let Some(top) = path.last_mut() {
                        top.1 += 1;
                    }
                    if seen.insert(evaluated) {
                        path.push((evaluated, 0));
                    }
                }
                None => {
                    left.push(module);
                    path.pop();
                }
            }
        }
    }
    let mut numbered = FxHashSet::default();
    for &root in left.iter().rev() {
        if !numbered.insert(root) {
            continue;
        }
        let (mut members, mut at) = (vec![root], 0);
        while at < members.len() {
            for &by in evaluated_by.get(&members[at]).into_iter().flatten() {
                if numbered.insert(by) {
                    members.push(by);
                }
            }
            at += 1;
        }
        if members.len() > 1 || requiring_themselves.contains(&root) {
            in_cycles.extend(members.into_iter().map(|member| (member, root.0)));
        }
    }
    in_cycles
}

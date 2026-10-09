//! Which of the runtime's own modules (`src/js`) are compiled with a program.
//!
//! The roots: what the program names in an `import`, a `require("..")`, an `import("..")` or a `process.getBuiltinModule("..")`;
//! what native code requires whatever the program does; what native code requires once the program reads a property such as
//! `process.stdout`; every module the loader has a name for, if a string that is made at run time can reach the loader. Then all that
//! those can come to require, eagerly or lazily: a module that is left out is interpreted for the life of the process, so what is in
//! doubt is included.

use bun_builtin_syntax::{Archive, Reason, Trigger};
use bun_resolve_builtins::HardcodedModule::{Alias, Cfg};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{BinOp, ExprId, ExprKind, File, SpecifierKind, UnOp};
use bun_sema::program::Module;
use bun_sema::util::{FxHashMap, FxHashSet};

/// Why a module is compiled with the program.
#[derive(Clone, PartialEq, Eq)]
pub enum Why {
    /// Native code requires it.
    Always,
    /// The program names it, by this specifier first.
    Named(Vec<u8>),
    /// The program reads `global.property`, or hands the global on.
    Trigger(Vec<u8>),
    /// A name that is made at run time can reach the module loader, through this.
    AnyName(&'static str),
    /// The module with this id can require it.
    RequiredBy(u32),
}

#[derive(Clone)]
pub struct Included {
    pub id: u32,
    pub why: Why,
}

pub struct Found {
    /// Ascending by id.
    pub included: Vec<Included>,
    /// The modules that the program or one of `included` names and that are native code: there is nothing to compile. By the name
    /// the module loader has for them, with the id if the registry has one. Sorted.
    pub native: Vec<(Vec<u8>, Option<u32>)>,
}

/// The globals that `Manifest::triggers` are about, and the modules that stand for them.
const GLOBALS: [(&[u8], &[&[u8]]); 3] = [(b"process", &[b"process", b"node:process"]), (b"Bun", &[b"bun"]), (b"console", &[])];
const GLOBAL_OBJECTS: [&[u8]; 4] = [b"globalThis", b"global", b"self", b"window"];
/// What may be read of them without a name reaching the module loader.
const OF_REQUIRE: [&[u8]; 4] = [b"resolve", b"cache", b"main", b"extensions"];
const OF_MODULE: [&[u8]; 6] = [b"exports", b"id", b"filename", b"path", b"paths", b"loaded"];
const OF_IMPORT_META: [&[u8]; 9] = [b"url", b"dir", b"dirname", b"file", b"filename", b"path", b"main", b"env", b"resolve"];
const LISTENS: [&[u8]; 5] = [b"on", b"once", b"addListener", b"prependListener", b"prependOnceListener"];
/// The modules that load others by name, or evaluate text, which can.
const MODULES_WITH_A_DOOR: [&[u8]; 8] = [b"module", b"node:module", b"vm", b"node:vm", b"repl", b"node:repl", b"worker_threads", b"node:worker_threads"];

struct Scan<'a, 's> {
    atoms: &'a Interner<'s>,
    get_builtin_module: Option<Atom>,
    /// By index in `GLOBALS`.
    globals: [Option<Atom>; GLOBALS.len()],
    global_objects: Vec<Atom>,
    /// The specifiers, in the order they are come by.
    named: Vec<Atom>,
    is_named: FxHashSet<Atom>,
    /// (index in `GLOBALS`, the property). `NONE`: the global is handed on, so any property may be read.
    read: FxHashSet<(usize, Atom)>,
    /// The first place that is found through which a name that is made at run time can reach the module loader.
    door: Option<&'static str>,
    /// So any global variable may be read, by any name.
    hands_on_global_object: bool,
    /// `process.on("message", ..)`: native code then does what it does for `process.send`.
    listens_for_messages: bool,
}

impl Scan<'_, '_> {
    fn name(&mut self, specifier: Atom) {
        if specifier.is_some() && self.is_named.insert(specifier) {
            self.named.push(specifier);
        }
    }

    /// The global that the module `specifier` stands for.
    fn global_of_module(&self, specifier: Atom) -> Option<usize> {
        let text = self.atoms.bytes(specifier);
        GLOBALS.iter().position(|global| global.1.contains(&text))
    }

    fn file(&mut self, hir: &File<'_>) {
        // By local name: the global that it is another name of.
        let mut aliases: Vec<(Atom, usize)> = Vec::new();
        for import in hir.imports.iter().filter(|import| !import.type_only) {
            let Some(global) = self.global_of_module(import.spec) else { continue };
            aliases.extend([import.default, import.namespace].into_iter().filter(|name| name.is_some()).map(|name| (name, global)));
            for spec in import.named.iter().map(|spec| &hir[spec]).filter(|spec| !spec.type_only) {
                self.read.insert((global, spec.imported));
            }
        }
        for used in hir.specifier_uses.iter() {
            let mut imports = hir.imports.iter().filter(|import| import.spec == used.spec).peekable();
            let is_only_for_types = used.kind == SpecifierKind::ImportType
                || used.kind == SpecifierKind::Import && imports.peek().is_some() && imports.all(|import| import.type_only);
            if is_only_for_types {
                continue;
            }
            self.name(used.spec);
            // Its value goes who knows where.
            if used.kind != SpecifierKind::Import
                && used.kind != SpecifierKind::SideEffect
                && let Some(global) = self.global_of_module(used.spec)
            {
                self.read.insert((global, Atom::NONE));
            }
        }
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            let ExprKind::String(specifier) = hir[hir.id_at(call.args, 0)].kind else { continue };
            match hir[call.callee].kind {
                ExprKind::Ident(known::require) if call.args.len() == 1 => {
                    self.name(specifier);
                    if let Some(global) = self.global_of_module(specifier) {
                        self.read.insert((global, Atom::NONE));
                    }
                }
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => self.name(specifier),
                _ => {}
            }
        }
        let global_named = |name: Atom| self.globals.iter().position(|&global| global == Some(name)).or_else(|| aliases.iter().find(|alias| alias.0 == name).map(|alias| alias.1));
        let global_at = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) => global_named(name),
            ExprKind::Dot { obj, name, .. } => match hir[obj].kind {
                ExprKind::Ident(object) if self.global_objects.contains(&object) => self.globals.iter().position(|&global| global == Some(name)),
                _ => None,
            },
            _ => None,
        };
        // What an expression is once the assertions around it are taken off: `(process as any).browser`, `process!.stdout`.
        let asserted = |mut e: ExprId| loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => e = expr,
                _ => return e,
            }
        };
        // The expressions whose value goes nowhere but into the read of a property by a name that is known.
        let mut is_only_read: FxHashSet<ExprId> = FxHashSet::default();
        let mut read: Vec<(usize, Atom)> = Vec::new();
        let mut mentions: Vec<(ExprId, usize)> = Vec::new();
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if let Some(global) = global_at(e) {
                mentions.push((e, global));
            }
            let (obj, name) = match expr.kind {
                ExprKind::Dot { obj, name, .. } => (obj, name),
                ExprKind::Index { obj, index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (obj, name),
                    _ => continue,
                },
                ExprKind::Unary { op: UnOp::Typeof, operand } => (operand, Atom::NONE),
                _ => continue,
            };
            let obj = asserted(obj);
            if let Some(global) = global_at(obj) {
                is_only_read.insert(obj);
                if name.is_some() {
                    read.push((global, name));
                }
            }
        }
        read.extend(mentions.into_iter().filter(|mention| !is_only_read.contains(&mention.0)).map(|mention| (mention.1, Atom::NONE)));
        self.read.extend(read);

        let is = |name: Atom, text: &[u8]| self.atoms.bytes(name) == text;
        let is_one_of = |name: Atom, names: &[&[u8]]| names.contains(&self.atoms.bytes(name));
        // The global variable that the expression names: `eval`, `globalThis.eval`.
        let variable_at = |e: ExprId| match hir[e].kind {
            ExprKind::Ident(name) => Some(name),
            ExprKind::Dot { obj, name, .. } => match hir[asserted(obj)].kind {
                ExprKind::Ident(object) if self.global_objects.contains(&object) => Some(name),
                _ => None,
            },
            _ => None,
        };
        let mut is_harmless: FxHashSet<ExprId> = FxHashSet::default();
        let mut listens_for_messages = false;
        for call in hir.calls.iter().filter(|call| !call.args.is_empty()) {
            if let ExprKind::Dot { obj, name, .. } = hir[call.callee].kind
                && global_at(asserted(obj)) == Some(0)
                && is_one_of(name, &LISTENS)
                && !matches!(hir[hir.id_at(call.args, 0)].kind, ExprKind::String(event) if !is(event, b"message"))
            {
                listens_for_messages = true;
            }
            if let ExprKind::String(_) = hir[hir.id_at(call.args, 0)].kind {
                match hir[call.callee].kind {
                    ExprKind::Ident(known::require) => _ = is_harmless.insert(call.callee),
                    ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => _ = is_harmless.insert(call.callee),
                    _ => {}
                }
            }
        }
        for expr in hir.exprs.iter() {
            let (obj, name) = match expr.kind {
                ExprKind::Dot { obj, name, .. } => (obj, name),
                ExprKind::Index { obj, index, .. } => match hir[index].kind {
                    ExprKind::String(name) => (obj, name),
                    _ => continue,
                },
                ExprKind::Unary { op: UnOp::Typeof, operand } => {
                    is_harmless.insert(asserted(operand));
                    continue;
                }
                ExprKind::Binary { op: BinOp::Instanceof, right, .. } => {
                    is_harmless.insert(asserted(right));
                    continue;
                }
                ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, left, right } => {
                    is_harmless.insert(asserted(left));
                    is_harmless.insert(asserted(right));
                    continue;
                }
                _ => continue,
            };
            let obj = asserted(obj);
            let may_be_read = match hir[obj].kind {
                ExprKind::ImportMeta => is_one_of(name, &OF_IMPORT_META),
                ExprKind::Ident(known::require) => is_one_of(name, &OF_REQUIRE),
                ExprKind::Ident(known::module) => is_one_of(name, &OF_MODULE),
                ExprKind::Ident(object) if self.global_objects.contains(&object) => true,
                _ => variable_at(obj) == Some(known::Function),
            };
            if may_be_read {
                is_harmless.insert(obj);
            }
        }
        let mut door = self.door;
        let mut hands_on_global_object = false;
        for (index, expr) in hir.exprs.iter().enumerate() {
            let e = ExprId::from(index as u32);
            if is_harmless.contains(&e) {
                continue;
            }
            let found = match expr.kind {
                ExprKind::ImportCall { args } if !matches!(hir[hir.id_at(args, 0)].kind, ExprKind::String(_)) => Some("import() of a name that is computed"),
                ExprKind::ImportMeta => Some("import.meta"),
                ExprKind::Ident(object) if self.global_objects.contains(&object) => {
                    hands_on_global_object = true;
                    Some("the global object")
                }
                ExprKind::Dot { name, .. } if Some(name) == self.get_builtin_module => Some("getBuiltinModule"),
                ExprKind::Dot { name, .. } if is(name, b"mainModule") => Some("mainModule"),
                _ => match variable_at(e) {
                    Some(known::require) => Some("require"),
                    Some(known::module) if matches!(expr.kind, ExprKind::Ident(_)) => Some("module"),
                    Some(known::eval) => Some("eval"),
                    Some(known::Function) => Some("Function"),
                    Some(name) if is(name, b"Worker") => Some("Worker"),
                    Some(name) if is(name, b"ShadowRealm") => Some("ShadowRealm"),
                    _ => None,
                },
            };
            door = door.or(found);
        }
        self.door = door;
        self.hands_on_global_object |= hands_on_global_object;
        self.listens_for_messages |= listens_for_messages;
    }

    fn reads(&self, global: &[u8], property: &[u8]) -> bool {
        let Some(global) = GLOBALS.iter().position(|it| *it.0 == *global) else { return true };
        self.hands_on_global_object
            || self.listens_for_messages && global == 0 && property == b"send"
            || self.read.contains(&(global, Atom::NONE))
            || self.atoms.lookup(property).is_some_and(|property| self.read.contains(&(global, property)))
    }

    fn fires(&self, trigger: &Trigger) -> bool {
        self.reads(&trigger.global, &trigger.property)
    }

    fn door(&self) -> Option<&'static str> {
        if self.door.is_some() {
            return self.door;
        }
        if self.named.iter().any(|&specifier| MODULES_WITH_A_DOOR.contains(&self.atoms.bytes(specifier))) {
            return Some("a module that loads modules or evaluates text");
        }
        if self.read.contains(&(0, Atom::NONE)) {
            return Some("process");
        }
        self.reads(b"Bun", b"plugin").then_some("Bun.plugin")
    }
}

/// `is_compiled`: by file, whether its code is in the program.
pub(crate) fn find(loaded: &[Option<Module<'_>>], atoms: &Interner<'_>, is_compiled: &[bool]) -> Found {
    let manifest = Archive::embedded().manifest();
    let mut scan = Scan {
        atoms,
        get_builtin_module: atoms.lookup(b"getBuiltinModule"),
        globals: GLOBALS.map(|global| atoms.lookup(global.0)),
        global_objects: GLOBAL_OBJECTS.iter().filter_map(|name| atoms.lookup(name)).collect(),
        named: Vec::new(),
        is_named: FxHashSet::default(),
        read: FxHashSet::default(),
        door: None,
        hands_on_global_object: false,
        listens_for_messages: false,
    };
    for (module, _) in loaded.iter().zip(is_compiled).filter(|it| *it.1) {
        if let Some(module) = module {
            scan.file(&module.hir);
        }
    }
    let mut roots: Vec<u32> = Vec::new();
    let mut why: FxHashMap<u32, Why> = FxHashMap::default();
    let mut add = |id: u32, reason: Why| {
        why.entry(id).or_insert_with(|| {
            roots.push(id);
            reason
        });
    };
    for &id in manifest.always_included() {
        add(id, Why::Always);
    }
    let mut native: Vec<(Vec<u8>, Option<u32>)> = Vec::new();
    for &specifier in &scan.named {
        let text = atoms.bytes(specifier);
        // Node's `--expose-internals`: as `exposed_internal_tag` of the module loader has it.
        if bun_resolve_builtins::expose_internals_enabled()
            && let Some(rest) = text.strip_prefix(b"internal/")
            && let Some(id) = manifest.module_for_loader(&[b"internal:", rest].concat())
        {
            add(id, Why::Named(text.to_vec()));
            continue;
        }
        let Some(alias) = Alias::get(text, bun_ast::Target::Bun, Cfg::default()) else { continue };
        match manifest.module_for_loader(alias.path.as_bytes()) {
            Some(id) => add(id, Why::Named(text.to_vec())),
            None => native.push((alias.path.as_bytes().to_vec(), manifest.modules().iter().find(|module| *module.name == *alias.path.as_bytes()).map(|module| module.id))),
        }
    }
    for trigger in manifest.triggers().iter().filter(|trigger| scan.fires(trigger)) {
        for &id in &trigger.modules {
            add(id, Why::Trigger([&trigger.global[..], b".", &trigger.property].concat()));
        }
    }
    if let Some(door) = scan.door() {
        for module in manifest.modules().iter().filter(|module| !module.path.is_empty()) {
            if module.name.starts_with(b"internal:") && !bun_resolve_builtins::expose_internals_enabled() {
                continue;
            }
            add(module.id, Why::AnyName(door));
        }
    }
    let mut included: Vec<Included> = Vec::new();
    for (id, reason) in manifest.closure(&roots) {
        let Some(module) = manifest.module(id) else { continue };
        if module.path.is_empty() {
            native.push((module.name.to_vec(), Some(id)));
            continue;
        }
        let why = match reason {
            Reason::Root => why[&id].clone(),
            Reason::RequiredBy(by) => Why::RequiredBy(by),
        };
        included.push(Included { id, why });
    }
    native.sort_unstable();
    native.dedup();
    Found { included, native }
}

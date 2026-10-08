//! Facts about classes, for what compiles a program by its types.
//!
//! Which declaration a name stands for is for whoever asks: an import gets its value from the file whose code runs, which the checker
//! does not know. So the facts of a class are asked for with those of the class it extends, if that is a class of the program.

use super::ByFile;
use crate::atom::Atom;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags};
use crate::check::Checker;
use crate::hir::{ClassId, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, FnKind, MemberKind, PropKey, StmtKind, UnOp, VarKind};
use crate::program::{FileId, Sym};
use crate::types::{Origin, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use std::sync::OnceLock;

#[derive(Default)]
pub(super) struct Shared {
    /// `classes_declaring_methods`
    declaring_methods: OnceLock<DeclaringMethods>,
    /// `class_facts_of_file`
    by_file: ByFile<FileFacts>,
}

/// A class of the program declares a method or an accessor.
#[derive(Copy, Clone, PartialEq, Eq)]
struct MethodDeclaration {
    class: (FileId, ClassId),
    is_static: bool,
    is_accessor: bool,
}

/// By name, in the order of the files.
type DeclaringMethods = FxHashMap<Atom, Vec<MethodDeclaration>>;

/// Something is done to the property `name` of an object of type `object`. `T`: what a type is called by.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct MethodStore<T = TypeId> {
    object: T,
    /// Its text, which is the same for every checker.
    name: Box<[u8]>,
    /// It is defined or deleted. Otherwise it is stored to, which for an accessor is a call of the setter and replaces nothing.
    defines: bool,
}

impl<T> MethodStore<T> {
    /// The same in terms of another name for the type. `None`: `rename` has none for it.
    pub fn renamed<U>(self, rename: impl FnOnce(T) -> Option<U>) -> Option<MethodStore<U>> {
        Some(MethodStore { object: rename(self.object)?, name: self.name, defines: self.defines })
    }
}

/// What `methods_replaced_by` finds.
#[derive(Default)]
pub struct ReplacedMethods {
    /// By class: the name of the member, and whether it is static.
    by_class: FxHashMap<(FileId, ClassId), Vec<(Atom, bool)>>,
    /// By name, as text.
    names: FxHashMap<Box<[u8]>, Atom>,
}

impl ReplacedMethods {
    /// Whether the method or the accessor `name` that the class declares may be replaced.
    pub fn contains(&self, file: FileId, class: ClassId, name: &[u8], is_static: bool) -> bool {
        match (self.by_class.get(&(file, class)), self.names.get(name)) {
            (Some(members), Some(&name)) => members.contains(&(name, is_static)),
            _ => false,
        }
    }
}

/// Which class of the program extends which.
#[derive(Default)]
struct Hierarchy {
    parent: FxHashMap<(FileId, ClassId), (FileId, ClassId)>,
    children: FxHashMap<(FileId, ClassId), Vec<(FileId, ClassId)>>,
}

impl Hierarchy {
    /// Whether `class` extends `ancestor`, through however many classes.
    fn extends(&self, class: (FileId, ClassId), ancestor: (FileId, ClassId)) -> bool {
        let mut at = class;
        // A class that extends itself is an error that is reported.
        for _ in 0..256 {
            match self.parent.get(&at) {
                Some(&parent) if parent == ancestor => return true,
                Some(&parent) => at = parent,
                None => return false,
            }
        }
        false
    }
}

/// What one pass over the expressions of a file finds.
#[derive(Default)]
struct FileFacts {
    /// The functions that need the environment they are made in.
    capturing: FxHashSet<FnId>,
    /// The classes with an initializer of an instance field that does. The constructor runs it.
    capturing_initializers: FxHashSet<ClassId>,
    /// The constructors that mention `new.target`, also from within an arrow function.
    mentioning_new_target: FxHashSet<FnId>,
}

/// How far up the functions around a reference need their environment.
#[derive(Copy, Clone)]
enum Reach {
    /// Up to the function whose activation holds what is referred to, which has it at hand. `None`: a loop of the module does.
    Function(Option<FnId>),
    /// Up to and including the member of the class. `None`: of the innermost class.
    Member(Option<ClassId>),
}

/// What follows from the declaration of a class and from the facts of the class it extends.
#[derive(Copy, Clone, Debug)]
pub struct ClassFacts {
    /// The program itself makes the objects of the class, and the class says what fields they have: it is written in TypeScript, and
    /// so is all it extends.
    pub is_laid_out: bool,
    /// The declaration is evaluated at most once, so there is one class object.
    pub is_evaluated_once: bool,
    /// The constructor has to be told `new.target`: it mentions it, a constructor that it hands the object on to has to be told, or
    /// the object is made by what the class extends, which goes by it.
    pub takes_new_target: bool,
    /// `new` may yield another object than the one that was made for it: the constructor, or one that it hands the object on to, has a
    /// `return` with a value.
    pub may_return_another_object: bool,
    /// The class, or a class whose static members it inherits, has a static member with a computed name, `Symbol.hasInstance` for one.
    pub has_computed_static_member: bool,
}

impl<'p, 's> Checker<'p, 's> {
    /// `base`: the facts of the class of the program that the `extends` clause names, if it names one.
    pub fn class_facts(&mut self, file: FileId, class: ClassId, base: Option<ClassFacts>) -> ClassFacts {
        let found = self.class_facts_of_file(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let c = &hir[class];
        // A class in JavaScript gets its fields by assignments to `this`, wherever they are.
        let is_laid_out = !hir.is_js && (c.extends.is_none() || base.is_some_and(|base| base.is_laid_out));
        // A class that is not laid out constructs what it extends by its value, as the language has it, whatever that is.
        let base = base.filter(|_| is_laid_out);
        let constructor = self.constructor_of_class(file, class);
        let mentions_new_target = constructor.is_some_and(|func| found.mentioning_new_target.contains(&func));
        let returns_value = constructor.is_some_and(|func| bound.ids(bound.fns[func.idx()].returns).any(|stmt| matches!(hir[stmt].kind, StmtKind::Return(value) if value.is_some())));
        let has_computed_static_member = c.members.iter().any(|member| hir[member].flags.contains(Flags::STATIC) && matches!(hir[member].key, PropKey::Computed(_)));
        ClassFacts {
            is_laid_out,
            is_evaluated_once: self.is_evaluated_once(file, bound.class_owner[class.idx()].to_parent()),
            takes_new_target: mentions_new_target || c.extends.is_some() && !is_laid_out || base.is_some_and(|base| base.takes_new_target),
            may_return_another_object: returns_value || base.is_some_and(|base| base.may_return_another_object),
            has_computed_static_member: has_computed_static_member || base.is_some_and(|base| base.has_computed_static_member),
        }
    }

    /// The constructor that the class declares: of the overloads, the one with the body.
    pub fn constructor_of_class(&self, file: FileId, class: ClassId) -> Option<FnId> {
        let hir = self.hir(file);
        (hir[class].members.iter())
            .map(|member| &hir[member])
            .find(|m| m.kind == MemberKind::Constructor && m.func.is_some() && !matches!(hir[m.func].body, FnBody::None))
            .map(|m| m.func)
    }

    /// Whether the node is evaluated at most once while the program runs: it is at the level of a module, in no function, static block or
    /// initializer of an instance field, and in no loop.
    pub fn is_evaluated_once(&self, file: FileId, node: Parent) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = node;
        loop {
            at = match at {
                Parent::File => return true,
                Parent::None | Parent::FnBody(_) | Parent::ParamDefault(_) => return false,
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => {
                    let is_loop = matches!(
                        hir[s].kind,
                        StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. }
                    );
                    if is_loop {
                        return false;
                    }
                    bound.stmt_parent[s.idx()]
                }
                Parent::MemberInit(m) if !hir[m].flags.contains(Flags::STATIC) => return false,
                // The name of a member and the initializer of a static field are evaluated with the class.
                Parent::MemberKey(m) | Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return false,
                },
                Parent::Decorator(class, _) => bound.class_owner[class.idx()].to_parent(),
                _ => self.parent_of_node(file, at),
            };
        }
    }

    /// Whether the function needs the environment it is made in: it, or a function within it, refers to a variable, a function or a class
    /// that is not there once and for all, but for each activation of a function around it or each turn of a loop; or to `super` or a
    /// `#name`, which are kept with the class. One that does not can be called by whoever knows it, without its closure.
    pub fn function_captures(&mut self, file: FileId, func: FnId) -> bool {
        self.class_facts_of_file(file).capturing.contains(&func)
    }

    /// The same for the constructor of the class, declared or not, with what it runs besides its body: the initializers of the instance
    /// fields, the definition of what has a name that is kept with the class, the constructor of what the class extends.
    pub fn constructor_captures(&mut self, file: FileId, class: ClassId) -> bool {
        let found = self.class_facts_of_file(file);
        let hir = self.hir(file);
        let c = &hir[class];
        c.extends.is_some()
            || found.capturing_initializers.contains(&class)
            || self.constructor_of_class(file, class).is_some_and(|func| found.capturing.contains(&func))
            || c.members.iter().any(|member| !hir[member].flags.contains(Flags::STATIC) && matches!(hir[member].key, PropKey::Computed(_) | PropKey::Private(_)))
    }

    /// Whether the computed name of a member is a symbol, going by its type.
    pub fn is_symbol_name(&mut self, file: FileId, name: ExprId) -> bool {
        let ty = self.type_of_expr(file, name);
        self.is_symbol_like(ty)
    }

    /// For each of `candidates`: whether its class object may be what one of the classes `extending` extends, going by the type of what
    /// stands after `extends` there. As in `function mixin<T extends new (..) => object>(Base: T) { return class extends Base {} }`, where
    /// it is not known which class that is. A type that says nothing, as `any`, is taken for none of them.
    pub fn may_be_extended_by_value(&mut self, extending: &[(FileId, ClassId)], candidates: &[(FileId, ClassId)]) -> Vec<bool> {
        let mut extended: Vec<TypeId> = Vec::new();
        for &(file, class) in extending {
            let mut ty = self.type_of_expr(file, self.hir(file)[class].extends);
            if self.is_instantiable(ty) {
                ty = self.base_constraint(ty);
            }
            if !self.says_nothing(ty) && !extended.contains(&ty) {
                extended.push(ty);
            }
        }
        (candidates.iter())
            .map(|&(file, class)| {
                let symbol = self.files.sym(file, self.bound(file).class_symbol[class.idx()]);
                let class_object = self.type_of_symbol(symbol);
                extended.iter().any(|&extended| self.is_assignable(class_object, extended))
            })
            .collect()
    }

    /// Appends the names of the global objects that the file does more with than the engine's knowledge of them allows for.
    ///
    /// A class of the engine that a class of the file extends, going by the type of what stands after `extends`, so that
    /// `const M = Map; class X extends M {}` counts: its instances are not all what the engine makes of itself.
    ///
    /// `console`, if the name stands for the global and is used in any way but `console.name`. That goes by the syntax of the uses, and
    /// has nothing to do with types.
    pub fn globals_altered_in(&mut self, file: FileId, out: &mut Vec<Atom>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut seen = FxHashSet::default();
        for (class, c) in hir.classes.iter().enumerate() {
            // The parser leaves nodes behind that are part of nothing.
            if c.extends.is_none() || c.flags.contains(Flags::AMBIENT) || bound.class_symbol[class].is_none() {
                continue;
            }
            let extended = self.type_of_expr(file, c.extends);
            for signature in self.signatures(extended, true).into_vec() {
                let made = self.sig_return(signature);
                self.add_global_classes_of(made, &mut seen, out);
            }
        }
        let Some(console) = self.atoms().lookup(b"console") else { return };
        let index = self.exprs_by_kind_of(file);
        let escapes = index.of(ExprTag::Ident).iter().any(|&e| {
            if !matches!(hir[e].kind, ExprKind::Ident(name) if name == console) {
                return false;
            }
            let is_read_from = match bound.expr_parent[e.idx()] {
                Parent::None => true,
                Parent::Expr(parent) => matches!(hir[parent].kind, ExprKind::Dot { obj, .. } if obj == e),
                _ => false,
            };
            !is_read_from && self.symbol_of_identifier(file, e, console).is_none_or(|sym| self.is_only_declared(sym))
        });
        if escapes {
            out.push(console);
        }
    }

    /// The type, and what it extends, as far as those are classes and interfaces that are global.
    fn add_global_classes_of(&mut self, ty: TypeId, seen: &mut FxHashSet<Sym>, out: &mut Vec<Atom>) {
        match self.data(ty) {
            TypeData::Ref { target, .. } => {
                let target = *target;
                if !seen.insert(target) {
                    return;
                }
                let name = self.files.symbol(target).name;
                if self.global_type_symbol(name) == Some(target) {
                    out.push(name);
                }
                for base in self.base_types(target).into_vec() {
                    self.add_global_classes_of(base, seen, out);
                }
            }
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                for &part in parts.iter() {
                    self.add_global_classes_of(part, seen, out);
                }
            }
            _ => {}
        }
    }

    /// Whether nothing in the program defines what the symbol stands for.
    fn is_only_declared(&self, sym: Sym) -> bool {
        match self.files.value_declaration(sym) {
            Some((file, decl)) => self.hir(file).kind == FileKind::Declaration || self.bound(file).modifier_flags(self.hir(file), decl).contains(Flags::AMBIENT),
            None => true,
        }
    }

    // ───────────────────────────── methods that are replaced ─────────────────────────────

    // A program may put something else in the place of a method or an accessor that a class declares: in an object, which gets a
    // property of its own by the name, or in the prototype object or the class object. It is seen to do so where something is stored to
    // `x.name`, or that is deleted or defined, and an object of the class may be `x`, going by the type of `x`. Where it is not seen to,
    // what an object of the class finds by the name is what the class declares, and whoever tries to change that is turned away.
    //
    // What a file does is found from the file alone, `stores_to_methods_in`. Which methods that replaces is decided once, from what all
    // files do, `methods_replaced_by`. So nobody knows of a method whether it may be replaced while files are still looked at.

    /// The files that classes of the program are declared in, in their order.
    fn files_declaring_classes(&self) -> Vec<FileId> {
        (0..self.files.modules.len() as u32).map(FileId).filter(|&file| !matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json)).collect()
    }

    /// From the declarations alone.
    fn classes_declaring_methods(&self) -> &'p DeclaringMethods {
        self.p.aot.classes.declaring_methods.get_or_init(|| {
            let mut declaring = DeclaringMethods::default();
            for file in self.files_declaring_classes() {
                let hir = self.hir(file);
                for (class, c) in hir.classes.iter().enumerate() {
                    if c.flags.contains(Flags::AMBIENT) {
                        continue;
                    }
                    for member in c.members.iter() {
                        let m = &hir[member];
                        let PropKey::Name(name) = m.key else { continue };
                        if !matches!(m.kind, MemberKind::Method | MemberKind::Getter | MemberKind::Setter) || m.func.is_none() || matches!(hir[m.func].body, FnBody::None) {
                            continue;
                        }
                        let entry = MethodDeclaration { class: (file, ClassId(class as u32)), is_static: m.flags.contains(Flags::STATIC), is_accessor: m.kind != MemberKind::Method };
                        let classes = declaring.entry(name).or_default();
                        if !classes.contains(&entry) {
                            classes.push(entry);
                        }
                    }
                }
            }
            declaring
        })
    }

    /// For what the file does to a property by the name of a method of some class of the program: the type of the object and the name,
    /// each pair once, in the order of the file. What counts: an assignment of any kind to `x.name`, to `x["name"]`, or to `x[key]`
    /// where the type of `key` is that of one string or of a few; `++`, `--`, `delete`; `Object.defineProperty`,
    /// `Object.defineProperties`, `Object.assign`, `Reflect.set`, `Reflect.defineProperty` and `Reflect.deleteProperty`, where the name is
    /// written down.
    ///
    /// Not `x.name = x.name.bind(x)`: what an object finds by the name still does what the method does.
    pub fn stores_to_methods_in(&mut self, file: FileId) -> Vec<MethodStore> {
        let mut found: Vec<(TypeId, Atom, bool)> = Vec::new();
        self.add_stores_to_methods_in(file, &mut found);
        let mut seen = FxHashSet::default();
        found.retain(|&store| seen.insert(store));
        found.into_iter().map(|(object, name, defines)| MethodStore { object, name: self.atoms().bytes(name).into(), defines }).collect()
    }

    /// The type of the object, the name, and `MethodStore::defines`.
    fn add_stores_to_methods_in(&mut self, file: FileId, out: &mut Vec<(TypeId, Atom, bool)>) {
        let declaring = self.classes_declaring_methods();
        let index = self.exprs_by_kind_of(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Whether it is defined or deleted. `None`: it is only read.
        let store_to = |e: ExprId| {
            let is_deleted = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
            (is_deleted || bound.get_assignment_target(hir, e).is_some()).then_some(is_deleted)
        };
        let matters = |name: Atom, defines: bool| declaring.get(&name).is_some_and(|declared| defines || declared.iter().any(|declaration| !declaration.is_accessor));
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot { obj, name, .. } = hir[e].kind else { continue };
            if declaring.contains_key(&name)
                && let Some(defines) = store_to(e)
                && matters(name, defines)
                && !self.is_bound_to_its_object(file, e)
            {
                out.push((self.type_of_expr(file, obj), name, defines));
            }
        }
        for &e in index.of(ExprTag::Index) {
            let ExprKind::Index { obj, index: key, .. } = hir[e].kind else { continue };
            if matches!(hir[key].kind, ExprKind::Number(_)) || self.is_bound_to_its_object(file, e) {
                continue;
            }
            let Some(defines) = store_to(e) else { continue };
            for name in self.names_of_key(file, key) {
                if matters(name, defines) {
                    out.push((self.type_of_expr(file, obj), name, defines));
                }
            }
        }
        for &e in index.of(ExprTag::Call) {
            let ExprKind::Call(call) = hir[e].kind else { continue };
            let ExprKind::Dot { obj: global, name: function, .. } = hir[hir[call].callee].kind else { continue };
            let ExprKind::Ident(global_name) = hir[global].kind else { continue };
            let (names_by_key, defines) = match (self.atoms().bytes(global_name), self.atoms().bytes(function)) {
                (b"Object" | b"Reflect", b"defineProperty") | (b"Reflect", b"deleteProperty") => (true, true),
                (b"Reflect", b"set") => (true, false),
                (b"Object", b"defineProperties") => (false, true),
                (b"Object", b"assign") => (false, false),
                _ => continue,
            };
            if !self.symbol_of_identifier(file, global, global_name).is_none_or(|sym| self.is_only_declared(sym)) {
                continue;
            }
            let args: Vec<ExprId> = hir.ids(hir[call].args).collect();
            let Some((&target, rest)) = args.split_first() else { continue };
            let mut names: Vec<Atom> = Vec::new();
            if names_by_key {
                names.extend(rest.first().into_iter().flat_map(|&key| self.names_of_key(file, key)));
            } else {
                for &literal in rest {
                    let ExprKind::Object(props) = hir[literal].kind else { continue };
                    names.extend(props.iter().filter_map(|p| hir[p].key.name()));
                }
            }
            for name in names {
                if matters(name, defines) {
                    out.push((self.type_of_expr(file, target), name, defines));
                }
            }
        }
    }

    /// The property names that the key of an element access can be, if those are a few strings that its type lists. None otherwise.
    fn names_of_key(&mut self, file: FileId, key: ExprId) -> Vec<Atom> {
        if let ExprKind::String(name) = self.hir(file)[key].kind {
            return vec![name];
        }
        let mut ty = self.type_of_expr(file, key);
        if self.is_instantiable(ty) {
            ty = self.base_constraint(ty);
        }
        match self.data(ty) {
            TypeData::StringLit { value, .. } => vec![*value],
            TypeData::Union(parts) => parts.iter().filter_map(|&part| if let TypeData::StringLit { value, .. } = self.data(part) { Some(*value) } else { None }).collect(),
            _ => Vec::new(),
        }
    }

    /// Whether `target` is the left side of `x.name = x.name.bind(x)`, or of the same with `x[key]`, where `x` is `this` or one variable.
    fn is_bound_to_its_object(&self, file: FileId, target: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(assignment) = bound.expr_parent[target.idx()] else { return false };
        let ExprKind::Assign { op: None, target: assigned, value } = hir[assignment].kind else { return false };
        let ExprKind::Call(call) = hir[value].kind else { return false };
        let ExprKind::Dot { obj: method, name: function, .. } = hir[hir[call].callee].kind else { return false };
        let mut args = hir.ids(hir[call].args);
        let (Some(this), None) = (args.next(), args.next()) else { return false };
        let is_same = |a: ExprId, b: ExprId| match (hir[a].kind, hir[b].kind) {
            (ExprKind::This, ExprKind::This) => true,
            (ExprKind::Ident(_), ExprKind::Ident(_)) => bound.expr_symbol[a.idx()].is_some() && bound.expr_symbol[a.idx()] == bound.expr_symbol[b.idx()],
            (ExprKind::String(a), ExprKind::String(b)) => a == b,
            _ => false,
        };
        assigned == target
            && self.atoms().bytes(function) == b"bind"
            && match (hir[target].kind, hir[method].kind) {
                (ExprKind::Dot { obj, name, .. }, ExprKind::Dot { obj: read_from, name: read, .. }) => name == read && is_same(obj, read_from) && is_same(obj, this),
                (ExprKind::Index { obj, index, .. }, ExprKind::Index { obj: read_from, index: read, .. }) => is_same(index, read) && is_same(obj, read_from) && is_same(obj, this),
                _ => false,
            }
    }

    /// The class of the program whose objects, or with `is_static` whose class object, the type is that of.
    fn class_of_type(&self, ty: TypeId, is_static: bool) -> Option<(FileId, ClassId)> {
        let symbol = match *self.data(ty) {
            TypeData::Ref { target, .. } | TypeData::ThisParam(target) if !is_static && self.files.flags(target).contains(SymFlags::CLASS) => target,
            TypeData::Anon { origin: Origin::ClassStatic(symbol), .. } if is_static => symbol,
            _ => return None,
        };
        match self.files.value_declaration(symbol)? {
            (file, Decl::Class(class)) if !self.is_only_declared(symbol) => Some((file, class)),
            _ => None,
        }
    }

    /// From what the files of the program do, `stores_to_methods_in`, in any order, to the methods and accessors that may be replaced. The
    /// one step that looks at the whole program.
    ///
    /// The object stored to may be of any class whose objects are of the type it is looked at as. For the type of a class those are
    /// the class and what extends it. For any other type, an interface for one, those that are assignable to it. What such an object
    /// finds by the name is declared by its class, by a class that it extends, or, as it may be of a class that extends its class, by one
    /// of those.
    pub fn methods_replaced_by(&mut self, stores: Vec<MethodStore>) -> ReplacedMethods {
        let mut replaced = ReplacedMethods::default();
        if stores.is_empty() {
            return replaced;
        }
        let declaring = self.classes_declaring_methods();
        let mut hierarchy = Hierarchy::default();
        for file in self.files_declaring_classes() {
            for class in 0..self.hir(file).classes.len() as u32 {
                let class = ClassId(class);
                let c = &self.hir(file)[class];
                if c.extends.is_none() || c.flags.contains(Flags::AMBIENT) || self.bound(file).class_symbol[class.idx()].is_none() {
                    continue;
                }
                let symbol = self.class_sym(file, class);
                let extended = self.base_types(symbol).into_vec().into_iter().find_map(|base| self.class_of_type(base, false));
                if let Some(extended) = extended {
                    hierarchy.parent.insert((file, class), extended);
                    hierarchy.children.entry(extended).or_default().push((file, class));
                }
            }
        }
        let mut seen = FxHashSet::default();
        for MethodStore { object, name: text, defines } in stores {
            let Some(name) = self.atoms().lookup(&text) else { continue };
            let Some(declared_by) = declaring.get(&name) else { continue };
            let mut parts = vec![object];
            while let Some(mut part) = parts.pop() {
                if self.is_instantiable(part) {
                    part = self.base_constraint(part);
                }
                part = self.non_nullable(part);
                if self.says_nothing(part) || !seen.insert((part, name, defines)) {
                    continue;
                }
                if let TypeData::Union(types) | TypeData::Intersection(types) = self.data(part) {
                    parts.extend(types.iter().copied());
                    continue;
                }
                let mut stored_to: Vec<((FileId, ClassId), bool)> = Vec::new();
                if let Some(class) = self.class_of_type(part, false) {
                    stored_to.push((class, false));
                } else if let Some(class) = self.class_of_type(part, true) {
                    stored_to.push((class, true));
                } else {
                    // Every class that has the method, by declaring or by inheriting it.
                    let mut having: Vec<(FileId, ClassId)> = declared_by.iter().filter(|declaration| !declaration.is_static).map(|declaration| declaration.class).collect();
                    let mut visited: FxHashSet<(FileId, ClassId)> = having.iter().copied().collect();
                    while let Some(class) = having.pop() {
                        let instances = self.type_of_instances(class.0, class.1);
                        if self.is_assignable(instances, part) {
                            // With all that extends it.
                            stored_to.push((class, false));
                            continue;
                        }
                        for &child in hierarchy.children.get(&class).map_or(&[][..], |children| &children[..]) {
                            if visited.insert(child) {
                                having.push(child);
                            }
                        }
                    }
                }
                for (class, is_static) in stored_to {
                    for declaration in declared_by {
                        let other = declaration.class;
                        if declaration.is_static == is_static && (defines || !declaration.is_accessor) && (other == class || hierarchy.extends(class, other) || hierarchy.extends(other, class)) {
                            let members = replaced.by_class.entry(other).or_default();
                            if !members.contains(&(name, is_static)) {
                                members.push((name, is_static));
                                replaced.names.entry(text.clone()).or_insert(name);
                            }
                        }
                    }
                }
            }
        }
        replaced
    }

    /// The checker that asks first finds them, from the tree and the symbols of the file alone.
    fn class_facts_of_file(&mut self, file: FileId) -> &'p FileFacts {
        let program = self.p;
        program.aot.classes.by_file.get_or_init(program.files.modules.len(), file, || self.find_class_facts_of_file(file))
    }

    fn find_class_facts_of_file(&mut self, file: FileId) -> FileFacts {
        let index = self.exprs_by_kind_of(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = FileFacts::default();
        for &e in index.of(ExprTag::Ident) {
            let ExprKind::Ident(name) = hir[e].kind else { continue };
            let parent = bound.expr_parent[e.idx()];
            if parent == Parent::None {
                continue;
            }
            if let Some(sym) = self.symbol_of_identifier(file, e, name)
                && let Some(holder) = self.activation_holding(file, sym)
            {
                self.note_capture(file, parent, Reach::Function(holder), &mut found);
            }
        }
        for &e in index.of(ExprTag::Super) {
            self.note_capture(file, bound.expr_parent[e.idx()], Reach::Member(None), &mut found);
        }
        for (&e, &class) in bound.private_class.iter() {
            self.note_capture(file, bound.expr_parent[e.idx()], Reach::Member(Some(class)), &mut found);
        }
        for &e in index.of(ExprTag::NewTarget) {
            let mut func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
            while func.is_some() && hir[func].kind == FnKind::Arrow {
                func = bound.fns[func.idx()].enclosing;
            }
            if func.is_some() && hir[func].kind == FnKind::Constructor {
                found.mentioning_new_target.insert(func);
            }
        }
        found
    }

    /// Whether there is one of what the declaration binds for as long as the program runs, so that it needs no environment to live in.
    pub fn is_bound_once(&self, file: FileId, decl: Decl) -> bool {
        self.activation_binding(file, decl).is_none()
    }

    /// `activation_binding` for what a reference in `file` refers to.
    fn activation_holding(&self, file: FileId, sym: Sym) -> Option<Option<FnId>> {
        let (declared_in, decl) = self.files.value_declaration(sym)?;
        if declared_in != file {
            return None;
        }
        self.activation_binding(file, decl)
    }

    /// The function whose activations each have their own of what the declaration binds. `Some(None)`: the turns of a loop of the module
    /// have. `None`: it is there once and for all, as what a module declares at its top level or imports.
    fn activation_binding(&self, file: FileId, decl: Decl) -> Option<Option<FnId>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let node = match decl {
            Decl::Var(pat) | Decl::Param(pat) | Decl::Require(pat) => {
                let mut pat = pat;
                loop {
                    match bound.pat_parent[pat.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                        PatParent::Param(p) => return Some(Some(bound.param_fn[p.idx()])),
                        PatParent::Var(d) => {
                            let stmt = Parent::Stmt(bound.var_stmt[d.idx()]);
                            // A `var` is a variable of the function, or of the module, wherever it is declared.
                            if hir[d].kind == VarKind::Var {
                                return self.enclosing_fn(file, stmt).map(Some);
                            }
                            break stmt;
                        }
                        PatParent::None => return None,
                    }
                }
            }
            Decl::Fn(func) => match bound.fns[func.idx()].owner {
                FnOwner::Stmt(s) => Parent::Stmt(s),
                FnOwner::Expr(e) => Parent::Expr(e),
                _ => return None,
            },
            Decl::Class(class) => bound.class_owner[class.idx()].to_parent(),
            _ => return None,
        };
        match self.enclosing_fn(file, node) {
            Some(func) => Some(Some(func)),
            None if self.is_evaluated_once(file, node) => None,
            None => Some(None),
        }
    }

    /// Something at `from` is found through the environments of the functions around it, as far up as `reach` says.
    fn note_capture(&self, file: FileId, from: Parent, reach: Reach, found: &mut FileFacts) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ends_at = |class: ClassId| matches!(reach, Reach::Member(wanted) if wanted.is_none_or(|wanted| wanted == class));
        let mut at = from;
        loop {
            let func = match at {
                Parent::None | Parent::File => return,
                Parent::Expr(e) if e.is_some() => {
                    at = bound.expr_parent[e.idx()];
                    continue;
                }
                Parent::Stmt(s) if s.is_some() => {
                    at = bound.stmt_parent[s.idx()];
                    continue;
                }
                Parent::MemberInit(m) => {
                    if let MemberOwner::Class(class) = bound.member_owner[m.idx()] {
                        if !hir[m].flags.contains(Flags::STATIC) {
                            found.capturing_initializers.insert(class);
                        }
                        if ends_at(class) {
                            return;
                        }
                    }
                    at = self.parent_of_node(file, at);
                    continue;
                }
                Parent::FnBody(func) => func,
                Parent::ParamDefault(p) => bound.param_fn[p.idx()],
                _ => {
                    at = self.parent_of_node(file, at);
                    continue;
                }
            };
            if matches!(reach, Reach::Function(holder) if holder == Some(func)) {
                return;
            }
            found.capturing.insert(func);
            if let FnOwner::Member(m) = bound.fns[func.idx()].owner
                && let MemberOwner::Class(class) = bound.member_owner[m.idx()]
                && ends_at(class)
            {
                return;
            }
            at = self.parent_of_node(file, Parent::FnBody(func));
        }
    }
}

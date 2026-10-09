//! Facts about classes, for what compiles a program by its types.
//!
//! Which declaration a name stands for is for whoever asks: an import gets its value from the file whose code runs, which the checker
//! does not know. So the facts of a class are asked for with those of the class it extends, if that is a class of the program.

use super::ByFile;
use crate::atom::{Atom, known};
use crate::bind::{ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::check::errors_names_and_exports::root_declaration;
use crate::hir::{
    BinOp, CallId, Chain, ClassId, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, FnKind, IdList, MemberKind, ModuleId, PatId, PatKind, PropKey, PropKind, StmtId, StmtKind, TypeNodeId, TypeNodeKind, UnOp,
    VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{Origin, PropFlags, PropSource, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
use std::sync::OnceLock;

#[derive(Default)]
pub(super) struct Shared {
    /// `classes_declaring_methods`
    declaring_methods: OnceLock<DeclaringMethods>,
    /// `computed_methods`
    computed_methods: OnceLock<Vec<((FileId, ClassId), ExprId)>>,
    /// `class_facts_of_file`
    by_file: ByFile<FileFacts>,
    /// `discriminants`
    discriminants: OnceLock<Discriminants>,
    /// `mutable_prototypes`
    mutable_prototypes: OnceLock<MutablePrototypes>,
    /// `set_builtin_requires`
    builtin_requires: OnceLock<FxHashMap<(FileId, Atom), FileId>>,
    /// `is_reified_namespace`
    reified_namespaces: OnceLock<ReifiedNamespaces>,
}

#[derive(Default)]
struct ReifiedNamespaces {
    namespaces: FxHashSet<Sym>,
    /// By file: the variables that it declares and one of them exports, as the file itself refers to them.
    variables: FxHashMap<FileId, Vec<SymbolId>>,
}

/// A function that declares its `this`, `function Node(this: Node, kind: Kind) { this.kind = kind; .. }`. Whoever constructs with it
/// hands it an object of that type to initialize.
struct ConstructorFunction {
    function: (FileId, FnId),
    /// The statements `this.name = value` that its body starts with, in their order, up to the first statement of another form and
    /// the first value that mentions `this`: nobody else has seen the object by then.
    initial_stores: Vec<InitialStore>,
}

/// `this.name = value`
struct InitialStore {
    name: Atom,
    /// Which parameter the value is: see `unmodified_parameter`. None also if the name comes twice among the stores.
    parameter: Option<u32>,
    /// `this.name`
    target: ExprId,
}

/// What the trees say of the properties that tell kinds of objects apart.
#[derive(Default)]
struct Discriminants {
    /// In the order of the program.
    constructor_functions: Vec<ConstructorFunction>,
    /// The names that are worth looking at. Some class, interface or type literal declares a property by the name whose type is
    /// written as a number, as `Kind.A`, which may be a member of an enum, as `K`, which may be a type parameter, or as a union with
    /// such a part.
    candidates: FxHashSet<Atom>,
    /// Of those: some file stores to a property by the name or deletes one, whatever the object, other than by an `InitialStore` of a
    /// parameter.
    mutated: FxHashSet<Atom>,
}

/// The `ConstructorFunction`s whose `prototype` object does not stay what it is at first, known to nobody else.
#[derive(Default)]
struct MutablePrototypes {
    /// All of them: it is replaced or given another prototype for a function that is not known.
    every: bool,
    functions: FxHashSet<(FileId, FnId)>,
}

/// What an expression stands for that something is done to as to a function.
enum NamedFunction {
    Constructor(FileId, FnId),
    /// Something that is no `ConstructorFunction`.
    Other,
    Unknown,
}

/// What is done with `E.prototype`.
#[derive(Copy, Clone, PartialEq)]
enum PrototypeUse {
    /// It is replaced, or given another prototype.
    Replaced,
    /// It is a value: whoever gets hold of it may do anything to it.
    Escapes,
    /// A property of it is read, called, stored to or defined.
    Accessed,
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

/// What a class extends.
enum Superclass {
    None,
    Known((FileId, ClassId)),
    /// No class of the program, or nobody knows which.
    Unknown,
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

/// `e` without the assertions around it: `(e as T)!`.
fn skip_assertions(hir: &File, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[e].kind {
        e = expr;
    }
    e
}

/// `Discriminants::candidates`. `type_parameters`: the names of those of the file.
fn may_name_a_number(hir: &File, ty: TypeNodeId, type_parameters: &FxHashSet<Atom>) -> bool {
    match hir[ty].kind {
        TypeNodeKind::NumberLit(_) => true,
        TypeNodeKind::Ref { name, args } => args.is_empty() && (name.len() > 1 || name.iter().all(|part| type_parameters.contains(&hir[part].text))),
        TypeNodeKind::Union(parts) => hir.ids(parts).any(|part| may_name_a_number(hir, part, type_parameters)),
        _ => false,
    }
}

/// What one pass over the expressions of a file finds.
#[derive(Default)]
struct FileFacts {
    /// The constructors that mention `new.target`, also from within an arrow function.
    mentioning_new_target: FxHashSet<FnId>,
    /// The functions that mention `super`, also from within an arrow function. No arrow functions themselves.
    mentioning_super: FxHashSet<FnId>,
    /// `this_may_be_uninitialized`
    with_uninitialized_this: FxHashSet<FnId>,
    /// `binding_of_identifier`
    required_in_blocks: Vec<RequiredInBlock>,
}

/// `const name = require("m")`, `let { name } = require("m")` in JavaScript, in a block, a clause or the head of a loop.
struct RequiredInBlock {
    name: Atom,
    pat: PatId,
    symbol: SymbolId,
    /// Of the statement that is the scope.
    start: u32,
    end: u32,
    /// `is_hidden_variable_required_in_block`
    is_hidden_variable: bool,
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
    /// By builtin file and specifier: the builtin module that `require(specifier)` yields the value of there. Once for the program, whichever
    /// checker is told, before anything is asked.
    pub fn set_builtin_requires(&self, requires: Vec<((FileId, Atom), FileId)>) {
        self.p.aot.classes.builtin_requires.get_or_init(|| requires.into_iter().collect());
    }

    pub(crate) fn builtin_module_required_by(&self, file: FileId, e: ExprId) -> Option<FileId> {
        self.files.module(file).builtin?;
        let specifier = crate::bind::required_specifier(self.hir(file), e)?;
        self.p.aot.classes.builtin_requires.get()?.get(&(file, specifier)).copied()
    }

    /// Whether somebody may get hold of the object that the `namespace` of TypeScript is, so that there has to be one: what it exports are
    /// its properties then, and whoever has the object can store to them, define and delete them. From the trees and the symbols of all
    /// files, once.
    ///
    /// It is mentioned otherwise than as the object of `N.name`. Or a module exports it, and the namespace object of some module is made.
    /// Or a namespace that is reified exports it. Where it is reached by a path, `a.b.N`, it goes by its name alone.
    pub fn is_reified_namespace(&self, namespace: Sym) -> bool {
        self.reified_namespaces().namespaces.contains(&namespace)
    }

    /// The variables that the file declares and a reified namespace exports, as the file itself refers to them. They are properties: not
    /// every store to them is seen.
    pub(super) fn variables_of_reified_namespaces(&self, file: FileId) -> &'p [SymbolId] {
        self.reified_namespaces().variables.get(&file).map_or(&[], |variables| &variables[..])
    }

    pub fn has_reified_namespaces(&self) -> bool {
        !self.reified_namespaces().namespaces.is_empty()
    }

    /// `member`: a function, a class, an enum or a namespace that a namespace exports. Whether the identifier `e` is within the block that
    /// declares it. There the name stands for the binding of the block. In another block of the namespace it stands for the property.
    pub fn is_within_declaring_block(&self, file: FileId, e: ExprId, member: Sym) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut around: Vec<ModuleId> = Vec::new();
        let mut at = bound.expr_parent[e.idx()];
        while !matches!(at, Parent::None | Parent::File) {
            if let Parent::Module(block) = at {
                around.push(block);
                at = Parent::Stmt(hir[block].stmt);
            }
            at = self.parent_of_node(file, at);
        }
        self.files().decls(member).into_iter().filter(|declared| declared.0 == file).any(|(_, decl)| {
            let stmt = match decl {
                Decl::Fn(func) => match bound.fns[func.idx()].owner {
                    FnOwner::Stmt(stmt) => stmt,
                    _ => return false,
                },
                Decl::Class(class) => match bound.class_owner[class.idx()] {
                    ClassOwner::Stmt(stmt) => stmt,
                    ClassOwner::Expr(_) => return false,
                },
                Decl::Enum(declaration) => hir[declaration].stmt,
                Decl::Module(declaration) => hir[declaration].stmt,
                _ => return false,
            };
            matches!(bound.stmt_parent[stmt.idx()], Parent::Module(block) if around.contains(&block))
        })
    }

    fn reified_namespaces(&self) -> &'p ReifiedNamespaces {
        self.p.aot.classes.reified_namespaces.get_or_init(|| self.find_reified_namespaces())
    }

    fn find_reified_namespaces(&self) -> ReifiedNamespaces {
        let files = self.files();
        let code = self.files_declaring_classes();
        let mut by_name: FxHashMap<Atom, Vec<Sym>> = FxHashMap::default();
        for &file in &code {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for (m, module) in hir.modules.iter().enumerate() {
                let m = ModuleId(m as u32);
                if module.flags.contains(Flags::AMBIENT) || !bound.is_instantiated_module(m, false) {
                    continue;
                }
                let namespace = files.export_symbol_of_value_symbol_if_exported(files.sym(file, bound.module_symbol[m.idx()]));
                // Merged with a function, a class or an enum, it is that object.
                if files.flags(namespace).intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM) {
                    continue;
                }
                let named = by_name.entry(files.symbol(namespace).name).or_default();
                if !named.contains(&namespace) {
                    named.push(namespace);
                }
            }
        }
        let mut found = ReifiedNamespaces::default();
        if by_name.is_empty() {
            return found;
        }
        let is_candidate = |sym: Sym| by_name.get(&files.symbol(sym).name).is_some_and(|named| named.contains(&sym));
        let mut is_module_object_made = false;
        for &file in &code {
            let (hir, bound, index) = (self.hir(file), self.bound(file), self.exprs_by_kind_of(file));
            let is_object_of_access = |e: ExprId| matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Dot { obj, chain: Chain::No, .. } if obj == e));
            is_module_object_made |= !index.of(ExprTag::ImportCall).is_empty() || index.of(ExprTag::Call).iter().any(|&e| crate::bind::required_specifier(hir, e).is_some());
            for &e in index.of(ExprTag::Ident) {
                let Some(symbol) = bound.symbols.get(bound.expr_symbol[e.idx()].idx()) else { continue };
                if !symbol.flags.intersects(SymFlags::VALUE_MODULE | SymFlags::ALIAS) || is_object_of_access(e) || bound.is_in_type_query(e) {
                    continue;
                }
                let sym = files.export_symbol_of_value_symbol_if_exported(files.sym(file, bound.expr_symbol[e.idx()]));
                let Some(sym) = (if files.flags(sym).contains(SymFlags::ALIAS) { files.resolve_alias(sym) } else { Some(sym) }) else { continue };
                if matches!(files.value_declaration(sym), Some((_, Decl::File))) {
                    is_module_object_made = true;
                } else if is_candidate(sym) {
                    found.namespaces.insert(sym);
                }
            }
            for &e in index.of(ExprTag::Dot) {
                if let ExprKind::Dot { name, .. } = hir[e].kind
                    && let Some(named) = by_name.get(&name)
                    && !is_object_of_access(e)
                {
                    found.namespaces.extend(named);
                }
            }
        }
        if is_module_object_made {
            for &file in &code {
                for (_, exported) in files.each_export(files.file_symbol(file)) {
                    let exported = if files.flags(exported).contains(SymFlags::ALIAS) { files.resolve_alias(exported) } else { Some(exported) };
                    found.namespaces.extend(exported.filter(|&sym| is_candidate(sym)));
                }
            }
        }
        let mut pending: Vec<Sym> = found.namespaces.iter().copied().collect();
        while let Some(namespace) = pending.pop() {
            for (_, member) in files.each_export(namespace) {
                // `export import a = b.c`
                let held = if files.flags(member).contains(SymFlags::ALIAS) { files.resolve_alias(member) } else { Some(member) };
                if let Some(held) = held.filter(|&held| is_candidate(held) && found.namespaces.insert(held)) {
                    pending.push(held);
                }
                for (file, decl) in files.decls(member) {
                    if matches!(decl, Decl::Var(_)) {
                        found.variables.entry(file).or_default().push(self.bound(file).symbol_of_declaration(decl));
                    }
                }
            }
        }
        found
    }

    /// What the identifier `e` refers to when the program runs. That is `symbol_of_identifier`, but for `const { a } = require("m")` in
    /// JavaScript: to the type checker it is an alias, which is declared in the scope of the function or the file, whatever block it
    /// stands in, and a second one of the name in another block is a symbol that no name finds. Within the block the name stands for
    /// what the block binds. Outside it stands for what it stands for around the function or the file.
    pub fn binding_of_identifier(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        match self.binding_by_block(file, e, name) {
            Some(found) => found,
            None => self.symbol_of_identifier(file, e, name),
        }
    }

    /// `None`: the identifier refers to what the binder has found for it.
    pub(super) fn binding_by_block(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Option<Sym>> {
        let required = &self.class_facts_of_file(file).required_in_blocks;
        if required.is_empty() {
            return None;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (found, pos) = (bound.expr_symbol[e.idx()], hir[e].pos);
        // Anything else that the binder has found is declared in a scope of its own, further in.
        if found.is_some() && !bound.symbols[found.idx()].decls.iter().any(|decl| matches!(decl, Decl::Require(_))) {
            return None;
        }
        let innermost = required.iter().filter(|binding| binding.name == name && (binding.start..binding.end).contains(&pos)).min_by_key(|binding| binding.end - binding.start);
        if let Some(binding) = innermost {
            return Some(Some(self.files().sym(file, binding.symbol)));
        }
        let outermost = required.iter().find(|binding| binding.symbol == found)?;
        let declared_in = bound.scope_of_declaration(hir, Decl::Require(outermost.pat)).some()?;
        Some(match bound.scopes[bound.container_scope(declared_in).idx()].parent.some() {
            Some(outer) => self.files().resolve_name(file, outer, name, SymFlags::VALUE),
            None => self.files().global(name, SymFlags::VALUE),
        })
    }

    /// Whether it is such a binding that no name finds and that is no `const`: the binder has the stores to it down for another symbol.
    pub fn is_hidden_variable_required_in_block(&mut self, sym: Sym) -> bool {
        self.class_facts_of_file(sym.file).required_in_blocks.iter().any(|binding| binding.symbol == sym.id && binding.is_hidden_variable)
    }

    /// Of an intersection with a primitive. `string & DisposableString` is an OBJECT that converts to a string: a part is of a class, or has a
    /// method. `string & { __brand: "Id" }` is a string with a brand, which has neither.
    pub fn is_wrapper_of_primitive(&mut self, ty: TypeId) -> bool {
        let TypeData::Intersection(parts) = self.data(ty) else { return false };
        parts.to_vec().into_iter().any(|part| {
            self.is_object_type(part)
                && (self.class_of_type(part, false).is_some() || self.members(part).is_some_and(|members| members.shape().props.iter().any(|prop| prop.flags.contains(PropFlags::METHOD))))
        })
    }

    /// Whether every declaration of the interface is ambient: it stands in a declaration file, or under `declare global`, `declare module`,
    /// `declare namespace`. Such an interface says what the host hands out, and what it requires is a wish: `interface ProcessEnv { KEY:
    /// string }`. It is a declaration without a body, which nothing is held to.
    pub fn is_ambient_interface(&self, interface: Sym) -> bool {
        let declarations = self.files().decls(interface);
        !declarations.is_empty()
            && declarations.into_iter().all(|(file, decl)| {
                let hir = self.hir(file);
                matches!(decl, Decl::Interface(_)) && (hir.kind == FileKind::Declaration || hir.is_ambient(hir.node(decl)))
            })
    }

    /// Whether what declares the value of the symbol is ambient: it stands in a declaration file, or under a `declare`.
    pub fn is_declared_ambient(&self, sym: Sym) -> bool {
        self.files().value_declaration(sym).is_some_and(|(file, decl)| {
            let hir = self.hir(file);
            hir.kind == FileKind::Declaration || hir.is_ambient(hir.node(decl))
        })
    }

    /// `const { E } = require("./m")`, where the module has `export const enum E`: the enum, if the expression is of the type of its object.
    /// There is no such object when the program runs, so what is of that type stands for the enum, and `E.member` for the constant.
    pub fn const_enum_typing(&mut self, file: FileId, e: ExprId) -> Option<Sym> {
        let ty = self.type_of_expr(file, e);
        match *self.data(ty) {
            TypeData::Anon { origin: Origin::EnumObject(declared), .. } if self.files().flags(declared).contains(SymFlags::CONST_ENUM) => Some(declared),
            _ => None,
        }
    }

    /// `base`: the facts of the class of the program that the `extends` clause names, if it names one.
    pub fn class_facts(&mut self, file: FileId, class: ClassId, base: Option<ClassFacts>) -> ClassFacts {
        let found = self.class_facts_of_file(file);
        let (hir, bound) = (self.hir(file), self.bound(file));
        let c = &hir[class];
        // A class in JavaScript gets its fields by assignments to `this`, wherever they are.
        let constructor = self.constructor_of_class(file, class);
        let is_initialized_in_order = !constructor.is_some_and(|func| found.with_uninitialized_this.contains(&func));
        let is_laid_out = !self.is_untyped_file(file) && (c.extends.is_none() || base.is_some_and(|base| base.is_laid_out) && is_initialized_in_order);
        // A class that is not laid out constructs what it extends by its value, as the language has it, whatever that is.
        let base = base.filter(|_| is_laid_out);
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

    /// The optional properties of the types that the class `implements` that its objects do not have by the class itself: no field, method
    /// or accessor of the name, declared or inherited. The implemented type and the name, in the order of the clause and of the types.
    /// `class Links implements LinksLike {}` says that its objects are used as a `LinksLike`, which is how they come by such a property.
    ///
    /// Not a name that two of the types give different types. Not a name that a subclass declares a method or an accessor by: its objects
    /// inherit the property, and a field that is absent is not looked for on the prototype chain. A subclass is a class of any file that
    /// is loaded. Where it is not known what a class extends: see `may_be_extended_by_value`.
    pub fn implemented_optional_properties(&mut self, file: FileId, class: ClassId) -> Vec<(TypeId, Atom)> {
        let hir = self.hir(file);
        let instances = self.type_of_instances(file, class);
        // With the type of the property. `None`: the types differ.
        let mut found: Vec<(TypeId, Atom, Option<TypeId>)> = Vec::new();
        for node in hir.ids(hir[class].implements) {
            let implemented = self.type_from_node(file, node);
            let Some(members) = self.members(implemented) else { continue };
            for prop in members.shape().props.iter() {
                if !prop.flags.contains(PropFlags::OPTIONAL) || prop.flags.contains(PropFlags::ACCESSOR) || self.type_of_property(instances, prop.name).is_some() {
                    continue;
                }
                let ty = self.type_of_prop(prop, members.mapper);
                match found.iter_mut().find(|known| known.1 == prop.name) {
                    Some(known) if known.2 != Some(ty) => known.2 = None,
                    Some(_) => {}
                    None => found.push((implemented, prop.name, Some(ty))),
                }
            }
        }
        found.retain(|known| known.2.is_some());
        if found.is_empty() {
            return Vec::new();
        }
        let class = (file, class);
        // A name that is computed may be any of them, unless it is a symbol. The class itself and what it extends may have such a method too.
        let computed: Vec<(FileId, ClassId)> =
            self.computed_methods().iter().filter(|&&(of, key)| self.is_untyped_file(of.0) || !self.is_symbol_name(of.0, key)).map(|&(of, _)| of).collect();
        if computed.into_iter().any(|other| other == class || self.may_extend(other, class) || self.may_extend(class, other)) {
            return Vec::new();
        }
        let declaring = self.classes_declaring_methods();
        found.retain(|known| {
            let declarations = declaring.get(&known.1).map_or(&[][..], |declarations| &declarations[..]);
            !declarations.iter().any(|declaration| !declaration.is_static && self.may_extend(declaration.class, class))
        });
        found.into_iter().map(|(implemented, name, _)| (implemented, name)).collect()
    }

    /// The properties that the objects of the class are declared to have and that nothing of the class defines: `declare x: T`, and what an
    /// interface of the name of the class declares, itself or by what it extends. In the order of the type.
    ///
    /// No method, no accessor. Not a name that the class it extends has. Not a name that a method or an accessor of a class on the same chain
    /// goes by, up or down: see `implemented_optional_properties`.
    pub fn properties_only_declared(&mut self, file: FileId, class: ClassId) -> Vec<Atom> {
        let instances = self.type_of_instances(file, class);
        let inherited = match self.superclass_of(file, class) {
            Superclass::None => None,
            Superclass::Known((file, class)) => Some(self.type_of_instances(file, class)),
            Superclass::Unknown => return Vec::new(),
        };
        let Some(members) = self.members(instances) else { return Vec::new() };
        let mut found: Vec<Atom> = Vec::new();
        for prop in members.shape().props.iter() {
            let PropSource::Symbol(declared) = prop.source else { continue };
            if !prop.flags.intersects(PropFlags::METHOD | PropFlags::ACCESSOR)
                && self.is_only_declared_member(declared)
                && !inherited.is_some_and(|inherited| self.type_of_property(inherited, prop.name).is_some())
            {
                found.push(prop.name);
            }
        }
        if found.is_empty() {
            return found;
        }
        let class = (file, class);
        let computed: Vec<(FileId, ClassId)> =
            self.computed_methods().iter().filter(|&&(of, key)| self.is_untyped_file(of.0) || !self.is_symbol_name(of.0, key)).map(|&(of, _)| of).collect();
        if computed.into_iter().any(|other| other == class || self.may_extend(other, class) || self.may_extend(class, other)) {
            return Vec::new();
        }
        let declaring = self.classes_declaring_methods();
        found.retain(|name| {
            let declarations = declaring.get(name).map_or(&[][..], |declarations| &declarations[..]);
            !declarations.iter().any(|declaration| {
                !declaration.is_static && (declaration.class == class || self.may_extend(declaration.class, class) || self.may_extend(class, declaration.class))
            })
        });
        found
    }

    /// Whether every declaration of the member is one that no code comes of: in an interface, or `declare x: T` in a class.
    fn is_only_declared_member(&self, member: Sym) -> bool {
        let declarations = self.files.decls(member);
        !declarations.is_empty()
            && declarations.into_iter().all(|(file, decl)| {
                let Decl::Member(m) = decl else { return false };
                let m_of = &self.hir(file)[m];
                match self.bound(file).member_owner[m.idx()] {
                    MemberOwner::Interface(_) => true,
                    MemberOwner::Class(_) => m_of.kind == MemberKind::Property && m_of.flags.contains(Flags::AMBIENT) && !m_of.flags.contains(Flags::STATIC),
                    _ => false,
                }
            })
    }

    fn superclass_of(&mut self, file: FileId, class: ClassId) -> Superclass {
        if self.hir(file)[class].extends.is_none() {
            return Superclass::None;
        }
        if self.bound(file).class_symbol[class.idx()].is_none() {
            return Superclass::Unknown;
        }
        let symbol = self.class_sym(file, class);
        self.base_types(symbol).into_vec().into_iter().find_map(|base| self.class_of_type(base, false)).map_or(Superclass::Unknown, Superclass::Known)
    }

    /// Whether `class` extends `ancestor`, through however many classes, as far as anybody knows.
    fn may_extend(&mut self, mut class: (FileId, ClassId), ancestor: (FileId, ClassId)) -> bool {
        // A class that extends itself is an error that is reported.
        for _ in 0..256 {
            match self.superclass_of(class.0, class.1) {
                Superclass::None => return false,
                Superclass::Known(superclass) if superclass != ancestor => class = superclass,
                Superclass::Known(_) => return true,
                Superclass::Unknown => return self.may_be_extended_by_value(&[class], &[ancestor])[0],
            }
        }
        true
    }

    /// The constructor that the class declares: of the overloads, the one with the body.
    pub fn constructor_of_class(&self, file: FileId, class: ClassId) -> Option<FnId> {
        let hir = self.hir(file);
        (hir[class].members.iter())
            .map(|member| &hir[member])
            .find(|m| m.kind == MemberKind::Constructor && m.func.is_some() && !matches!(hir[m.func].body, FnBody::None))
            .map(|m| m.func)
    }

    /// The class that the variable holds whenever it holds anything: `const Links = class { .. }`, where the declaration is evaluated at
    /// most once and says nothing else of what the variable is.
    pub fn class_held_by_constant(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        let (file, Decl::Var(pat)) = self.files.value_declaration(sym)? else { return None };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
        let declaration = &hir[d];
        if declaration.kind != VarKind::Const || declaration.flags.contains(Flags::AMBIENT) || declaration.ty.is_some() || declaration.init.is_none() {
            return None;
        }
        let ExprKind::Class(class) = hir[declaration.init].kind else { return None };
        self.is_evaluated_once(file, Parent::Expr(declaration.init)).then_some((file, class))
    }

    /// The class whose class object the variable holds whenever it holds anything, however often its declaration is evaluated: the
    /// binding of a class declaration that nothing is stored to, or a `const` whose initializer is a class expression, with or without
    /// assertions around it.
    pub fn class_held_by_variable(&self, sym: Sym) -> Option<(FileId, ClassId)> {
        let (file, decl) = self.files.value_declaration(sym)?;
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            Decl::Class(class) => {
                let local = bound.symbol_of_declaration(decl).some()?;
                let is_assigned = self.files.flags(sym).contains(SymFlags::ASSIGNED)
                    || bound.symbols[local.idx()].flags.contains(SymFlags::ASSIGNED)
                    || !bound.assignments_to(local).is_empty()
                    || self.is_stored_through_assertions(file, local);
                // What a script declares at its top level, every file sees.
                let is_seen_by_its_file_only = self.files.module(file).is_module() || self.enclosing_fn(file, bound.class_owner[class.idx()].to_parent()).is_some();
                (!hir[class].flags.contains(Flags::AMBIENT) && !is_assigned && is_seen_by_its_file_only).then_some((file, class))
            }
            Decl::Var(pat) => {
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else { return None };
                let declaration = &hir[d];
                if declaration.kind != VarKind::Const || declaration.flags.contains(Flags::AMBIENT) || declaration.init.is_none() {
                    return None;
                }
                let ExprKind::Class(class) = hir[skip_assertions(hir, declaration.init)].kind else { return None };
                Some((file, class))
            }
            _ => None,
        }
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

    /// Whether nothing in the program defines what the symbol stands for: the declaration is ambient, or its file is not compiled with the
    /// program, as one that is only imported for its types.
    fn is_only_declared(&self, sym: Sym) -> bool {
        match self.files.value_declaration(sym) {
            Some((file, decl)) => !self.is_compiled(file) || self.bound(file).modifier_flags(self.hir(file), decl).contains(Flags::AMBIENT),
            None => true,
        }
    }

    // ───────────────────────────── function prototypes ─────────────────────────────

    /// Appends the names of the properties that the file defines on a `prototype` object, in source order. With `P` written as
    /// `E.prototype` or `E["prototype"]`, whatever `E` is, with or without assertions around it:
    ///
    /// * `P.name = ..` and `P["name"] = ..`, compound assignments too;
    /// * `Object.defineProperty(P, "name", ..)`, `Reflect.defineProperty(P, "name", ..)`, `Reflect.set(P, "name", ..)`;
    /// * the keys that are written down in the object literals of `Object.defineProperties(P, { .. })` and `Object.assign(P, { .. }, ..)`.
    ///
    /// Syntax only, and nothing else: no alias of `P`, no store through `any`, no computed key, no spread, no argument that is not a
    /// literal, not `P = { .. }`. This is an allow-list and no fact. The run time refuses to define a property that is named like a field
    /// on the `prototype` of a function that initializes records, unless the name is listed. For a name that is listed, compiled code
    /// looks at the prototype where such a record lacks the field.
    pub fn prototype_property_names_in(&mut self, file: FileId, out: &mut Vec<Atom>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if matches!(hir.kind, FileKind::Declaration | FileKind::Json) || bound.ran_out_of_stack {
            return;
        }
        let is_prototype = |e: ExprId| match hir[skip_assertions(hir, e)].kind {
            ExprKind::Dot { name, .. } => name == known::prototype,
            ExprKind::Index { index, .. } => matches!(hir[index].kind, ExprKind::String(name) if name == known::prototype),
            _ => false,
        };
        for (index, node) in hir.exprs.iter().enumerate() {
            // The parser leaves nodes behind that are part of nothing.
            if bound.expr_parent[index] == Parent::None {
                continue;
            }
            let e = ExprId(index as u32);
            match node.kind {
                ExprKind::Dot { obj, name, .. } if is_prototype(obj) && self.store_to_access(file, e) == Some(false) => out.push(name),
                ExprKind::Index { obj, index: key, .. } if is_prototype(obj) && self.store_to_access(file, e) == Some(false) => {
                    if let ExprKind::String(name) = hir[key].kind {
                        out.push(name);
                    }
                }
                ExprKind::Call(call) => {
                    let ExprKind::Dot { obj: global, name: function, .. } = hir[hir[call].callee].kind else { continue };
                    let ExprKind::Ident(global_name) = hir[global].kind else { continue };
                    let takes_key = match (self.atoms().bytes(global_name), self.atoms().bytes(function)) {
                        (b"Object" | b"Reflect", b"defineProperty") | (b"Reflect", b"set") => true,
                        (b"Object", b"defineProperties" | b"assign") => false,
                        _ => continue,
                    };
                    let mut args = hir.ids(hir[call].args);
                    if !args.next().is_some_and(|target| is_prototype(target)) || !self.symbol_of_identifier(file, global, global_name).is_none_or(|sym| self.is_only_declared(sym)) {
                        continue;
                    }
                    if takes_key {
                        if let Some(key) = args.next()
                            && let ExprKind::String(name) = hir[key].kind
                        {
                            out.push(name);
                        }
                        continue;
                    }
                    for source in args {
                        if let ExprKind::Object(props) = hir[skip_assertions(hir, source)].kind {
                            out.extend(props.iter().filter_map(|p| match hir[p].key {
                                PropKey::Name(name) if hir[p].kind != PropKind::Spread => Some(name),
                                _ => None,
                            }));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Whether the objects that the function initializes may inherit from anything: the function is a `ConstructorFunction`, and the
    /// program is seen to replace its `prototype` object, to give that another prototype, to construct with another `new.target`, or
    /// to get hold of that object as a value.
    ///
    /// This is no fact. Where it is not seen, the run time keeps the `prototype` object of the function as it is and refuses the rest.
    pub fn has_mutable_prototype(&self, file: FileId, func: FnId) -> bool {
        let known = self.mutable_prototypes();
        known.functions.contains(&(file, func)) || known.every && self.discriminants().constructor_functions.iter().any(|it| it.function == (file, func))
    }

    pub fn number_of_constructor_functions(&self) -> usize {
        self.discriminants().constructor_functions.len()
    }

    /// From the trees and the symbols alone, of all files that are loaded, TypeScript and JavaScript, compiled with the program or not.
    fn mutable_prototypes(&self) -> &'p MutablePrototypes {
        self.p.aot.classes.mutable_prototypes.get_or_init(|| {
            let mut found = MutablePrototypes::default();
            if self.discriminants().constructor_functions.is_empty() {
                return found;
            }
            for file in self.files_declaring_classes() {
                // Of a tree that is not bound to its end, nobody knows what is what.
                found.every |= self.bound(file).ran_out_of_stack;
                if found.every {
                    break;
                }
                self.add_mutable_prototypes_in(file, &mut found);
            }
            found
        })
    }

    /// With `E` for any expression, with or without assertions around it or around `E.prototype`.
    ///
    /// Replaced: `E.prototype` or `E["prototype"]` is the target of an assignment of any kind;
    /// `Object.setPrototypeOf(E.prototype, ..)`, `Reflect.setPrototypeOf(E.prototype, ..)`, `E.prototype.__proto__ = ..`;
    /// `Object.defineProperty(E, "prototype", ..)`, `Reflect.defineProperty(E, "prototype", ..)`, `Reflect.set(E, "prototype", ..)`,
    /// `Object.defineProperties(E, { prototype: .. })`, `Object.assign(E, { prototype: .. })`; `Reflect.construct(E, args, newTarget)`;
    /// `inherits(E, ..)` and `x.inherits(E, ..)`, by the name of the callee. Where `E` is not known, that goes for every function.
    ///
    /// Escapes: `E.prototype` anywhere else but as the object of a member access, as the first argument of what
    /// `prototype_property_names_in` knows, and as an operand of `===`, `!==`, `==`, `!=`, `typeof`, `!`, `void`. Where `E` is not known, that goes for none: `hasProperty(ctor.prototype, name)` in a loop
    /// over constructors would otherwise go for all.
    fn add_mutable_prototypes_in(&self, file: FileId, found: &mut MutablePrototypes) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let names_prototype = |key: ExprId| matches!(hir[key].kind, ExprKind::String(name) if name == known::prototype);
        // `E`, and whether its `prototype` is replaced and does not only escape.
        let mut sites: Vec<(ExprId, bool)> = Vec::new();
        for (index, node) in hir.exprs.iter().enumerate() {
            // The parser leaves nodes behind that are part of nothing.
            if bound.expr_parent[index] == Parent::None {
                continue;
            }
            let e = ExprId(index as u32);
            match node.kind {
                ExprKind::Dot { obj, name, .. } if name == known::prototype => match self.use_of_prototype(file, e) {
                    PrototypeUse::Accessed => {}
                    how => sites.push((obj, how == PrototypeUse::Replaced)),
                },
                ExprKind::Index { obj, index: key, .. } if names_prototype(key) => match self.use_of_prototype(file, e) {
                    PrototypeUse::Accessed => {}
                    how => sites.push((obj, how == PrototypeUse::Replaced)),
                },
                ExprKind::Call(call) => {
                    let mut args = hir.ids(hir[call].args);
                    let Some(first) = args.next() else { continue };
                    let is_replaced = match self.method_of_global(file, call) {
                        Some((b"Object" | b"Reflect", b"defineProperty")) | Some((b"Reflect", b"set")) => args.next().is_some_and(|key| names_prototype(key)),
                        Some((b"Object", b"defineProperties" | b"assign")) => args.any(|source| {
                            matches!(hir[skip_assertions(hir, source)].kind, ExprKind::Object(props) if props.iter().any(|p| matches!(hir[p].key, PropKey::Name(name) if name == known::prototype)))
                        }),
                        Some((b"Reflect", b"construct")) => args.nth(1).is_some(),
                        Some(_) => false,
                        None => matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) | ExprKind::Dot { name, .. } if self.atoms().bytes(name) == b"inherits"),
                    };
                    if is_replaced {
                        sites.push((first, true));
                    }
                }
                _ => {}
            }
        }
        for (function, is_replaced) in sites {
            match self.function_named_by(file, function, 0) {
                NamedFunction::Constructor(of, func) => {
                    found.functions.insert((of, func));
                }
                NamedFunction::Unknown if is_replaced => found.every = true,
                NamedFunction::Unknown | NamedFunction::Other => {}
            }
        }
    }

    /// `prototype`: `E.prototype` or `E["prototype"]`.
    fn use_of_prototype(&self, file: FileId, prototype: ExprId) -> PrototypeUse {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.store_to_access(file, prototype).is_some() {
            return PrototypeUse::Replaced;
        }
        let mut asserted = prototype;
        while let Parent::Expr(parent) = bound.expr_parent[asserted.idx()]
            && parent.is_some()
            && matches!(hir[parent].kind, ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) if expr == asserted)
        {
            asserted = parent;
        }
        let Parent::Expr(parent) = bound.expr_parent[asserted.idx()] else { return PrototypeUse::Escapes };
        let Some(parent) = parent.some() else { return PrototypeUse::Escapes };
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == asserted => {
                if self.atoms().bytes(name) == b"__proto__" && self.store_to_access(file, parent).is_some() { PrototypeUse::Replaced } else { PrototypeUse::Accessed }
            }
            ExprKind::Index { obj, .. } if obj == asserted => PrototypeUse::Accessed,
            ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq, .. } | ExprKind::Unary { op: UnOp::Typeof | UnOp::Not | UnOp::Void, .. } => PrototypeUse::Accessed,
            ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(asserted) => match self.method_of_global(file, call) {
                Some((_, b"setPrototypeOf")) => PrototypeUse::Replaced,
                Some((b"Object", b"defineProperty" | b"defineProperties" | b"assign")) | Some((b"Reflect", b"defineProperty" | b"set")) => PrototypeUse::Accessed,
                _ => PrototypeUse::Escapes,
            },
            _ => PrototypeUse::Escapes,
        }
    }

    /// For a call of `Object.name(..)` or `Reflect.name(..)`, where those are the globals: the two names.
    fn method_of_global(&self, file: FileId, call: CallId) -> Option<(&'p [u8], &'p [u8])> {
        let hir = self.hir(file);
        let ExprKind::Dot { obj: global, name: method, .. } = hir[hir[call].callee].kind else { return None };
        let ExprKind::Ident(global_name) = hir[global].kind else { return None };
        let names = (self.atoms().bytes(global_name), self.atoms().bytes(method));
        (matches!(names.0, b"Object" | b"Reflect") && self.resolve_identifier(file, global, global_name, true).ok().flatten().is_none_or(|sym| self.is_only_declared(sym))).then_some(names)
    }

    /// What the expression stands for: a function expression, the name of a function, or a `const` whose initializer stands for one,
    /// through imports as the checker resolves them, with or without assertions. `depth`: how many such names have been followed.
    fn function_named_by(&self, file: FileId, e: ExprId, depth: u32) -> NamedFunction {
        let hir = self.hir(file);
        let e = skip_assertions(hir, e);
        let constructor = |of: FileId, func: FnId| self.discriminants().constructor_functions.iter().any(|it| it.function == (of, func)).then_some(NamedFunction::Constructor(of, func));
        match hir[e].kind {
            ExprKind::Fn(func) => constructor(file, func).unwrap_or(NamedFunction::Other),
            ExprKind::Class(_) | ExprKind::Object(_) | ExprKind::Array(_) => NamedFunction::Other,
            ExprKind::Ident(name) => {
                let Some(mut sym) = self.resolve_identifier(file, e, name, true).ok().flatten() else { return NamedFunction::Unknown };
                if self.files.flags(sym).contains(SymFlags::ALIAS) {
                    let Some(target) = self.files.resolve_alias(sym) else { return NamedFunction::Unknown };
                    sym = target;
                }
                // What other code defines is no function of the program.
                if self.is_only_declared(sym) {
                    return NamedFunction::Other;
                }
                let declared = self.files.decls(sym).into_iter().find_map(|(of, decl)| if let Decl::Fn(func) = decl { constructor(of, func) } else { None });
                if let Some(declared) = declared {
                    return declared;
                }
                match self.files.value_declaration(sym) {
                    Some((of, Decl::Var(pat))) => match self.bound(of).pat_parent[pat.idx()] {
                        PatParent::Var(d) if self.hir(of)[d].kind == VarKind::Const && self.hir(of)[d].init.is_some() && depth < 8 => self.function_named_by(of, self.hir(of)[d].init, depth + 1),
                        _ => NamedFunction::Unknown,
                    },
                    Some((_, Decl::Param(_) | Decl::Require(_))) | None => NamedFunction::Unknown,
                    Some(_) => NamedFunction::Other,
                }
            }
            _ => NamedFunction::Unknown,
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
    pub(super) fn files_declaring_classes(&self) -> Vec<FileId> {
        let is_code = |&file: &FileId| !matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json) && !self.files.module(file).is_opaque();
        (0..self.files.modules.len() as u32).map(FileId).filter(is_code).collect()
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

    /// The methods and accessors of the objects of a class whose names are computed: the class and the name, in the order of the files.
    /// From the declarations alone.
    fn computed_methods(&self) -> &'p [((FileId, ClassId), ExprId)] {
        self.p.aot.classes.computed_methods.get_or_init(|| {
            let mut computed = Vec::new();
            for file in self.files_declaring_classes() {
                let hir = self.hir(file);
                for (class, c) in hir.classes.iter().enumerate() {
                    if c.flags.contains(Flags::AMBIENT) {
                        continue;
                    }
                    for m in c.members.iter().map(|member| &hir[member]) {
                        if let PropKey::Computed(key) = m.key
                            && matches!(m.kind, MemberKind::Method | MemberKind::Getter | MemberKind::Setter)
                            && !m.flags.contains(Flags::STATIC)
                            && m.func.is_some()
                            && !matches!(hir[m.func].body, FnBody::None)
                        {
                            computed.push(((file, ClassId(class as u32)), key));
                        }
                    }
                }
            }
            computed
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
        let hir = self.hir(file);
        let matters = |name: Atom, defines: bool| declaring.get(&name).is_some_and(|declared| defines || declared.iter().any(|declaration| !declaration.is_accessor));
        for &e in index.of(ExprTag::Dot) {
            let ExprKind::Dot { obj, name, .. } = hir[e].kind else { continue };
            if declaring.contains_key(&name)
                && let Some(defines) = self.store_to_access(file, e)
                && matters(name, defines)
                && !self.is_bound_to_its_object(file, e)
            {
                self.add_store_to_method(file, obj, name, defines, out);
            }
        }
        for &e in index.of(ExprTag::Index) {
            let ExprKind::Index { obj, index: key, .. } = hir[e].kind else { continue };
            if matches!(hir[key].kind, ExprKind::Number(_)) || self.is_bound_to_its_object(file, e) {
                continue;
            }
            let Some(defines) = self.store_to_access(file, e) else { continue };
            for name in self.names_of_key(file, key) {
                if matters(name, defines) {
                    self.add_store_to_method(file, obj, name, defines, out);
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
                    self.add_store_to_method(file, target, name, defines, out);
                }
            }
        }
    }

    /// What is done to the property that the access `e` names, besides reading it: whether it is deleted, and not stored to. `None`: it
    /// is only read. What is stored to may be cast first: `(x.name as any) = value`.
    fn store_to_access(&self, file: FileId, mut e: ExprId) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        while let Parent::Expr(parent) = bound.expr_parent[e.idx()]
            && parent.is_some()
            && matches!(hir[parent].kind, ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) if expr == e)
        {
            e = parent;
        }
        let is_deleted = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if parent.is_some() && matches!(hir[parent].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
        (is_deleted || bound.get_assignment_target(hir, e).is_some()).then_some(is_deleted)
    }

    /// The object is of the checker's type of the expression `object`, or of what that may yield besides: `as` coerces and does not
    /// assert, so that `(x as T).name = value` may store to whatever `x` is.
    fn add_store_to_method(&mut self, file: FileId, object: ExprId, name: Atom, defines: bool, out: &mut Vec<(TypeId, Atom, bool)>) {
        let own = self.type_of_expr(file, object);
        out.push((own, name, defines));
        let yielded = self.type_yielded_by(file, object);
        if yielded != own {
            out.push((yielded, name, defines));
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
    pub(super) fn class_of_type(&self, ty: TypeId, is_static: bool) -> Option<(FileId, ClassId)> {
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
                if !self.hir(file)[class].flags.contains(Flags::AMBIENT)
                    && let Superclass::Known(extended) = self.superclass_of(file, class)
                {
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

    // ───────────────────────────── discriminants ─────────────────────────────

    // `kind` in `interface Node { kind: Kind }`, `interface Block extends Node { kind: Kind.Block; .. }` tells what an object is going to
    // be looked at as. Where an object is made with a value for such a property, and the property keeps it, the engine can make the
    // object what it is going to be from the start.

    /// From the trees and the symbols alone, of all files that are loaded, compiled with the program or not.
    fn discriminants(&self) -> &'p Discriminants {
        self.p.aot.classes.discriminants.get_or_init(|| {
            let mut files = self.files_declaring_classes();
            files.sort_by_key(|&file| self.files.rank_of_file(file));
            let mut found = Discriminants::default();
            for &file in &files {
                let hir = self.hir(file);
                if self.is_untyped_file(file) {
                    continue;
                }
                for (func, f) in hir.fns.iter().enumerate() {
                    if matches!(f.kind, FnKind::Decl | FnKind::Expr)
                        && f.this_ty(hir).is_some()
                        && let FnBody::Block(body) = f.body
                    {
                        let func = FnId(func as u32);
                        found.constructor_functions.push(ConstructorFunction { function: (file, func), initial_stores: self.initial_stores_to_this(file, func, body) });
                    }
                }
                let type_parameters: FxHashSet<Atom> = hir.type_params.iter().map(|parameter| parameter.name).collect();
                for member in hir.members.iter() {
                    if member.kind == MemberKind::Property
                        && let PropKey::Name(name) = member.key
                        && member.ty.is_some()
                        && may_name_a_number(hir, member.ty, &type_parameters)
                    {
                        found.candidates.insert(name);
                    }
                }
            }
            if found.candidates.is_empty() {
                return found;
            }
            let mut initial: FxHashSet<(FileId, ExprId)> = FxHashSet::default();
            for of in &found.constructor_functions {
                initial.extend(of.initial_stores.iter().filter(|store| store.parameter.is_some()).map(|store| (of.function.0, store.target)));
            }
            for &file in &files {
                // Of a tree that is not bound to its end, nobody knows what is a store.
                if self.bound(file).ran_out_of_stack {
                    found.mutated = found.candidates.clone();
                    break;
                }
                let hir = self.hir(file);
                for (e, node) in hir.exprs.iter().enumerate() {
                    let name = match node.kind {
                        ExprKind::Dot { name, .. } => name,
                        ExprKind::Index { index, .. } => match hir[index].kind {
                            ExprKind::String(name) => name,
                            _ => continue,
                        },
                        _ => continue,
                    };
                    let e = ExprId(e as u32);
                    if found.candidates.contains(&name) && !initial.contains(&(file, e)) && self.store_to_access(file, e).is_some() {
                        found.mutated.insert(name);
                    }
                }
            }
            found
        })
    }

    /// The functions of the program that declare their `this`, in program order (`rank_of_file`).
    pub(super) fn constructor_functions(&self) -> Vec<(FileId, FnId)> {
        self.discriminants().constructor_functions.iter().map(|it| it.function).collect()
    }

    /// Whether `new` may hand an object that is made as `made` to the constructor function: it declares a `this` that the object is of. A
    /// `this` that says nothing of its properties, `this: unknown`, is that of a function that passes it on.
    pub(super) fn may_construct(&mut self, function: (FileId, FnId), made: TypeId) -> bool {
        let this = self.type_of_this_parameter(function.0, function.1);
        !self.says_nothing(this) && this != TypeId::OBJECT && !self.admits_primitives(this) && self.is_assignable(made, this)
    }

    /// `ConstructorFunction::initial_stores`
    fn initial_stores_to_this(&self, file: FileId, func: FnId, body: IdList<StmtId>) -> Vec<InitialStore> {
        let hir = self.hir(file);
        let mentions_of_this = self.exprs_by_kind_of(file).of(ExprTag::This);
        let mut stores: Vec<InitialStore> = Vec::new();
        for stmt in hir.ids(body) {
            let StmtKind::Expr(e) = hir[stmt].kind else { break };
            let ExprKind::Assign { op: None, target, value } = hir[e].kind else { break };
            let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[target].kind else { break };
            let within_value = hir[value].pos..hir[value].end;
            if !matches!(hir[obj].kind, ExprKind::This) || mentions_of_this.iter().any(|&this| within_value.contains(&hir[this].pos)) {
                break;
            }
            let mut parameter = self.unmodified_parameter(file, func, value);
            for earlier in stores.iter_mut().filter(|earlier| earlier.name == name) {
                (earlier.parameter, parameter) = (None, None);
            }
            stores.push(InitialStore { name, parameter, target });
        }
        stores
    }

    /// Which parameter of the function the expression is, if it is nothing but the name of one that holds what the caller passes for
    /// as long as the function runs: it is a plain name without a default, takes one argument, and nothing is stored to it.
    fn unmodified_parameter(&self, file: FileId, func: FnId, e: ExprId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(_) = hir[e].kind else { return None };
        let symbol = bound.expr_symbol[e.idx()].some()?;
        let position = hir[func].params.iter().position(|p| matches!(hir[hir[p].pat].kind, PatKind::Ident(_)) && bound.pat_symbol[hir[p].pat.idx()] == symbol)?;
        let parameter = &hir[hir[func].params.at(position)];
        let is_unmodified = parameter.default.is_none()
            && !parameter.flags.contains(Flags::REST)
            && bound.assignments_to(symbol).is_empty()
            && !self.is_stored_through_assertions(file, symbol);
        is_unmodified.then_some(position as u32)
    }

    /// Whether the property `name` of an object that is made as `made` is a number that no code of the program replaces by the name,
    /// once the object has it.
    ///
    /// This is a fact: the object is made what an object with that number in the property is going to be looked at as, and is never
    /// made anything that goes with another number.
    ///
    /// * No file that is loaded, TypeScript or JavaScript, stores to a property by the name or deletes one, whatever the object:
    ///   `x.name`, `x["name"]`, through `as`, `!` and `satisfies`, as the target of an assignment of any kind, of `++` and `--`, of a
    ///   destructuring, of `for-in` and `for-of`. A property of an object literal, a field of a class and a parameter property are
    ///   what other objects start with.
    /// * But for the stores of a parameter that a `ConstructorFunction` starts with.
    ///
    /// Two kinds of store are not ruled out, and are for whoever relies on this to check where they happen. One of those initial stores,
    /// where the function is handed an object that is not new: `Node.call(old, kind)`. And what goes through the run time: a name that
    /// is computed, `Object.assign`, `Object.defineProperty`, `Reflect.set`.
    pub fn is_immutable_discriminant(&mut self, made: TypeId, name: Atom) -> bool {
        let known = self.discriminants();
        if !known.candidates.contains(&name) || known.mutated.contains(&name) {
            return false;
        }
        let Some(property) = self.type_of_property(made, name) else { return false };
        let parts = self.parts(property);
        !parts.is_empty() && parts.iter().all(|&part| self.is_number_like(part))
    }

    /// For `new callee(..)` where the object is made at the expression, as `made`, and handed to whatever `callee` turns out to be: an
    /// argument and the name of an `is_immutable_discriminant`, such that the property is never stored to by its name, or holds that
    /// argument from before anybody else sees the object.
    ///
    /// What initializes the object is a function that declares a `this` the object is of. Every such function of the program stores
    /// that parameter to that property, among the stores it starts with, and no other `ConstructorFunction` stores to the name. A
    /// `this` that says nothing of its properties, `this: unknown`, is that of a function that passes it on.
    ///
    /// `None`: that does not hold of any argument, or there is no such function. Of several, the one that the first of the functions
    /// stores first.
    pub fn discriminant_of_new(&mut self, file: FileId, e: ExprId, made: TypeId) -> Option<(usize, Atom)> {
        let hir = self.hir(file);
        let ExprKind::New(call) = hir[e].kind else { return None };
        let mut stored_by_all: Option<Vec<(Atom, u32)>> = None;
        let mut others: Vec<&ConstructorFunction> = Vec::new();
        for handed in &self.discriminants().constructor_functions {
            if !self.may_construct(handed.function, made) {
                others.push(handed);
                continue;
            }
            let stores = |name: Atom, parameter: u32| handed.initial_stores.iter().any(|store| store.name == name && store.parameter == Some(parameter));
            stored_by_all = Some(match stored_by_all {
                None => handed.initial_stores.iter().filter_map(|store| Some((store.name, store.parameter?))).collect(),
                Some(so_far) => so_far.into_iter().filter(|&(name, parameter)| stores(name, parameter)).collect(),
            });
        }
        // Which argument comes after a spread depends on what is spread.
        let written = hir.ids(hir[call].args).take_while(|&argument| !matches!(hir[argument].kind, ExprKind::Spread(_))).count();
        stored_by_all?.into_iter().find_map(|(name, parameter)| {
            let is_stored_by_others = others.iter().any(|other| other.initial_stores.iter().any(|store| store.name == name));
            ((parameter as usize) < written && !is_stored_by_others && self.is_immutable_discriminant(made, name)).then_some((parameter as usize, name))
        })
    }

    /// For an object literal that is made as `made`: the first of its properties that is an `is_immutable_discriminant`. The literal
    /// gives it its value and nothing in the literal replaces that: all names are written down, this one once, and nothing is spread.
    pub fn discriminant_of_object_literal(&mut self, file: FileId, e: ExprId, made: TypeId) -> Option<Atom> {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[e].kind else { return None };
        if props.iter().any(|p| hir[p].kind == PropKind::Spread || !matches!(hir[p].key, PropKey::Name(_))) {
            return None;
        }
        props.iter().find_map(|p| {
            let PropKey::Name(name) = hir[p].key else { return None };
            let is_written_once = props.iter().filter(|&other| matches!(hir[other].key, PropKey::Name(of_other) if of_other == name)).count() == 1;
            (matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) && is_written_once && self.is_immutable_discriminant(made, name)).then_some(name)
        })
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
        // The function whose `this` and `new.target` the expression sees.
        let receiver_of = |e: ExprId| {
            let mut func = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
            while func.is_some() && hir[func].kind == FnKind::Arrow {
                func = bound.fns[func.idx()].enclosing;
            }
            func.some()
        };
        found.mentioning_new_target.extend(index.of(ExprTag::NewTarget).iter().filter_map(|&e| receiver_of(e)));
        found.mentioning_super.extend(index.of(ExprTag::Super).iter().filter_map(|&e| receiver_of(e)));
        let mut mentions_of_this: FxHashMap<FnId, Vec<ExprId>> = FxHashMap::default();
        for &e in index.of(ExprTag::This).iter().chain(index.of(ExprTag::Super)) {
            if let Some(func) = receiver_of(e).filter(|&func| hir[func].kind == FnKind::Constructor) {
                mentions_of_this.entry(func).or_default().push(e);
            }
        }
        let callee_of_super_call = |e: ExprId| match hir[e].kind {
            ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Super) => Some(hir[call].callee),
            _ => None,
        };
        for class in (0..hir.classes.len() as u32).map(ClassId).filter(|&class| hir[class].extends.is_some()) {
            let Some(func) = self.constructor_of_class(file, class) else { continue };
            let FnBody::Block(body) = hir[func].body else { continue };
            let binding = hir.ids(body).find_map(|stmt| match hir[stmt].kind {
                StmtKind::Expr(e) => Some((callee_of_super_call(e)?, hir[e].end)),
                _ => None,
            });
            let is_bound_first = binding.is_some_and(|(callee, end)| {
                let is_another_super_call = |e: ExprId| matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if callee_of_super_call(parent) == Some(e));
                mentions_of_this.get(&func).is_none_or(|mentions| mentions.iter().all(|&e| e == callee || hir[e].pos >= end && !is_another_super_call(e)))
                    && bound.ids(bound.fns[func.idx()].returns).all(|stmt: StmtId| hir[stmt].start >= end)
            });
            if !is_bound_first {
                found.with_uninitialized_this.insert(func);
            }
        }
        for pat in (0..if hir.is_js { hir.pats.len() as u32 } else { 0 }).map(PatId) {
            if let PatKind::Ident(name) = hir[pat].kind
                && bound.required_by(hir, pat).is_some()
                && let PatParent::Var(declaration) = root_declaration(bound, pat)
                && hir[declaration].kind != VarKind::Var
            {
                let around = match bound.stmt_parent[bound.var_stmt[declaration.idx()].idx()] {
                    Parent::Stmt(around) => around,
                    Parent::Case(clause) => bound.case_stmt[clause.idx()],
                    _ => StmtId::NONE,
                };
                if around.is_some() {
                    let symbol = bound.pat_symbol[pat.idx()];
                    let is_found_by_name = (bound.scope_of_declaration(hir, Decl::Require(pat)).some())
                        .is_some_and(|scope| self.files().resolve_name(file, bound.container_scope(scope), name, SymFlags::ALIAS) == Some(self.files().sym(file, symbol)));
                    let is_hidden_variable = hir[declaration].kind != VarKind::Const && !is_found_by_name;
                    found.required_in_blocks.push(RequiredInBlock { name, pat, symbol, start: hir[around].start, end: hir[around].loc.end, is_hidden_variable });
                }
            }
        }
        found
    }

    /// Of the constructor that a class with an `extends` clause declares: whether `this` may be asked for, `super(..)` called or the
    /// constructor left while it is not known whether `super(..)` has returned. It is known where one statement directly in the body is the
    /// only `super(..)`, and every mention of `this` and `super`, also from within an arrow function, and every `return` comes after it.
    pub fn this_may_be_uninitialized(&mut self, file: FileId, func: FnId) -> bool {
        self.class_facts_of_file(file).with_uninitialized_this.contains(&func)
    }

    /// Whether the function, which is no arrow function, mentions `new.target`, also from within an arrow function.
    pub fn mentions_new_target(&mut self, file: FileId, func: FnId) -> bool {
        self.class_facts_of_file(file).mentioning_new_target.contains(&func)
    }

    /// Whether the function, which is no arrow function, looks at its `this`: it mentions `this` or `super`, also from within an arrow
    /// function, or it is a constructor, which initializes it.
    pub(super) fn uses_this(&mut self, file: FileId, func: FnId) -> bool {
        self.hir(file)[func].kind == FnKind::Constructor || self.bound(file).fns[func.idx()].contains_this || self.class_facts_of_file(file).mentioning_super.contains(&func)
    }

    /// Whether there is one of what the declaration binds for as long as the program runs, so that it needs no environment to live in.
    pub fn is_bound_once(&self, file: FileId, decl: Decl) -> bool {
        self.activation_binding(file, decl).is_none()
    }

    /// The function whose activations each have their own of what the declaration binds. `Some(None)`: the turns of a loop of the module
    /// have. `None`: it is there once and for all, as what a module declares at its top level or imports.
    pub(super) fn activation_binding(&self, file: FileId, decl: Decl) -> Option<Option<FnId>> {
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


}

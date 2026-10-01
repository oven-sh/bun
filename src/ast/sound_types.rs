//! Sound types: TypeScript annotations lowered to `$$t(value, mask)` runtime
//! tag checks.
//!
//! A mask over-approximates the set of runtime tags a TypeScript type allows.
//! A mask that is too wide only loses a check; a mask that is too narrow
//! throws in a correct program, so everything unknown resolves to [`mask::TOP`]
//! and no check is emitted for it.
//!
//! The parser turns each annotation into a [`SoundType`] while it skips it. A
//! name can be declared after its use or in another module, so a `SoundType`
//! is either a mask or an index into [`ModuleTypes::nodes`], and [`Resolver`]
//! evaluates it during the visit pass. `ModuleTypes` owns all of its data so
//! that one module's table can be shared with the parsers of its importers.

use std::sync::Arc;

use bun_collections::{HashMap, StringHashMap};

/// The callee of every emitted check.
pub const CHECK_FN_NAME: &[u8] = b"$$t";

/// A total partition of JavaScript values.
/// A set of tags. Every value has exactly one.
pub type Mask = u32;

pub mod mask {
    use super::Mask;

    pub const UNDEFINED: Mask = 1;
    pub const NULL: Mask = 2;
    pub const BOOLEAN: Mask = 4;
    pub const NUMBER: Mask = 8;
    pub const STRING: Mask = 16;
    pub const SYMBOL: Mask = 32;
    pub const BIGINT: Mask = 64;
    /// Callable objects.
    pub const FUNCTION: Mask = 128;
    /// Real JavaScript arrays.
    pub const ARRAY: Mask = 256;
    /// Objects that are none of the other kinds.
    pub const PLAIN_OBJECT: Mask = 512;
    /// One tag for each type of typed array, in the engine's order:
    /// `typed_array(0)` is `Int8Array`.
    pub const TYPED_ARRAY_KINDS: u32 = 12;
    const FIRST_TYPED_ARRAY_BIT: u32 = 10;
    pub const TYPED_ARRAYS: Mask = ((1 << TYPED_ARRAY_KINDS) - 1) << FIRST_TYPED_ARRAY_BIT;
    #[inline]
    pub const fn typed_array(kind: u32) -> Mask {
        1 << (FIRST_TYPED_ARRAY_BIT + kind)
    }
    /// One tag for each of the other kinds of object that the engine can identify
    /// by its cell type, in the order it numbers them after the typed arrays.
    const FIRST_KIND_BIT: u32 = FIRST_TYPED_ARRAY_BIT + TYPED_ARRAY_KINDS;
    pub const MAP: Mask = 1 << FIRST_KIND_BIT;
    pub const SET: Mask = 1 << (FIRST_KIND_BIT + 1);
    pub const WEAK_MAP: Mask = 1 << (FIRST_KIND_BIT + 2);
    pub const WEAK_SET: Mask = 1 << (FIRST_KIND_BIT + 3);
    pub const REGEXP: Mask = 1 << (FIRST_KIND_BIT + 4);
    pub const PROMISE: Mask = 1 << (FIRST_KIND_BIT + 5);
    pub const DATE: Mask = 1 << (FIRST_KIND_BIT + 6);
    pub const ERROR: Mask = 1 << (FIRST_KIND_BIT + 7);
    const KINDS: u32 = 8;
    pub const KINDS_OF_OBJECT: Mask = ((1 << KINDS) - 1) << FIRST_KIND_BIT;
    /// Objects that are neither callable nor arrays.
    pub const OTHER_OBJECT: Mask = PLAIN_OBJECT | TYPED_ARRAYS | KINDS_OF_OBJECT;

    /// Every value. Never emitted.
    pub const TOP: Mask = (1 << (FIRST_KIND_BIT + KINDS)) - 1;
    /// Nothing that `to_wire` gives is this or more.
    pub const WIRE_END: u32 = (TYPED_ARRAY_KINDS + KINDS + 1) << FIRST_TYPED_ARRAY_BIT;
    pub const OBJECT: Mask = FUNCTION | ARRAY | OTHER_OBJECT;
    pub const NON_NULLISH: Mask = TOP & !(UNDEFINED | NULL);
    pub const PROPERTY_KEY: Mask = STRING | NUMBER | SYMBOL;
    /// Primitives that stay assignable to an intersection with an object type
    /// (`string & { __brand: "x" }`).
    pub const BRANDABLE: Mask = BOOLEAN | NUMBER | STRING | SYMBOL | BIGINT;

    /// What `$$t` is passed. The engine has one tag for the objects that are
    /// neither callable nor arrays and, above the tags, room to say that they
    /// are typed arrays of one type: one more than which. `None` if every value
    /// gets past what this comes to.
    pub const fn to_wire(m: Mask) -> Option<u32> {
        const WIRE_TOP: u32 = (1 << FIRST_TYPED_ARRAY_BIT) - 1;
        let tags = m & (WIRE_TOP & !PLAIN_OBJECT);
        let typed = m & (TYPED_ARRAYS | KINDS_OF_OBJECT);
        let wire = if m & OTHER_OBJECT == 0 {
            tags
        } else if m & PLAIN_OBJECT == 0 && typed.is_power_of_two() {
            tags | PLAIN_OBJECT
                | (typed.trailing_zeros() - FIRST_TYPED_ARRAY_BIT + 1) << FIRST_TYPED_ARRAY_BIT
        } else {
            // Some of them: there is no saying which.
            tags | PLAIN_OBJECT
        };
        if wire == WIRE_TOP { None } else { Some(wire) }
    }

    pub const fn from_wire(wire: u32) -> Mask {
        const WIRE_TOP: u32 = (1 << FIRST_TYPED_ARRAY_BIT) - 1;
        let tags = wire & (WIRE_TOP & !PLAIN_OBJECT);
        let kind = wire >> FIRST_TYPED_ARRAY_BIT;
        if wire & PLAIN_OBJECT == 0 {
            tags
        } else if kind == 0 {
            tags | OTHER_OBJECT
        } else {
            tags | typed_array(kind - 1)
        }
    }

    #[inline]
    pub const fn normalize(m: Mask) -> Mask {
        if m == 0 || m >= TOP { TOP } else { m }
    }

    pub const fn intersect(a: Mask, b: Mask) -> Mask {
        if a == TOP || b == TOP {
            // The unknown side may be a primitive that the other side brands.
            let known = if a == TOP { b } else { a };
            return if known & OBJECT == 0 { known } else { TOP };
        }
        let mut r = a & b;
        if b & OBJECT != 0 {
            r |= a & BRANDABLE;
        }
        if a & OBJECT != 0 {
            r |= b & BRANDABLE;
        }
        normalize(r)
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum Level {
    #[default]
    Off = 0,
    /// Parameters, returns, typed variables, casts, typed stores.
    Basic = 1,
    /// Also `e!`, reads of typed `this` fields, and calls of same-file functions.
    Full = 2,
    /// Also reads of members and elements, and calls of methods, whose static
    /// type is a primitive. The static type of the object is inferred, and
    /// only decides where a check goes.
    Infer = 3,
}

impl Level {
    #[inline]
    pub fn is_enabled(self) -> bool {
        self != Level::Off
    }

    /// The value of `--sound-types=<value>`, `soundTypes: <value>` and `BUN_SOUND_TYPES`.
    pub fn from_option_value(value: &[u8]) -> Option<Level> {
        Some(match value {
            b"" | b"1" | b"true" | b"basic" => Level::Basic,
            b"2" | b"full" => Level::Full,
            b"3" | b"infer" => Level::Infer,
            b"0" | b"false" | b"off" => Level::Off,
            _ => return None,
        })
    }

    /// `self`, or the level `BUN_SOUND_TYPES` asks for if that is higher. Only for a build that
    /// makes an executable: a build script's other bundles ship as text that runs elsewhere.
    pub fn or_from_env(self, makes_executable: bool) -> Level {
        if !makes_executable {
            return self;
        }
        bun_core::env_var::BUN_SOUND_TYPES::get()
            .and_then(Level::from_option_value)
            .map_or(self, |env| self.max(env))
    }

    /// `self`, or `Off` if `BUN_SOUND_TYPES_EXCLUDE` names `path`.
    pub fn unless_excluded_by_env(self, path: &[u8]) -> Level {
        if self.is_enabled()
            && let Some(excluded) = bun_core::env_var::BUN_SOUND_TYPES_EXCLUDE::get()
            && bun_core::strings::split(excluded, b",")
                .any(|part| !part.is_empty() && bun_core::strings::contains(path, part))
        {
            return Level::Off;
        }
        self
    }
}

/// A type as far as the parse pass knows it.
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub struct SoundType(u32);

impl SoundType {
    /// No annotation, or one that allows every value.
    pub const TOP: SoundType = SoundType(0);
    /// A literal `any` or `unknown`. Same as `TOP` except that a cast to it
    /// opts the operand out of the check of the enclosing annotation.
    pub const ANY: SoundType = SoundType(1 << 30);
    const NODE_BIT: u32 = 1 << 31;

    #[inline]
    pub const fn from_mask(m: Mask) -> SoundType {
        let m = mask::normalize(m);
        if m == mask::TOP {
            SoundType::TOP
        } else {
            SoundType(m)
        }
    }

    #[inline]
    pub const fn is_top(self) -> bool {
        self.0 == 0 || self.0 == Self::ANY.0
    }

    /// `None` when the type has to be resolved.
    #[inline]
    pub const fn as_mask(self) -> Option<Mask> {
        if self.is_top() {
            Some(mask::TOP)
        } else if self.0 & Self::NODE_BIT != 0 {
            None
        } else {
            Some(self.0)
        }
    }

    #[inline]
    const fn node_index(self) -> usize {
        (self.0 & !Self::NODE_BIT) as usize
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct NameId(u32);

#[derive(Copy, Clone)]
pub enum Node {
    /// `Name` or `Name<Arg0, ...>`. `arg0` is only evaluated for the utility
    /// types in [`takes_first_type_argument`].
    Ref {
        name: NameId,
        arg0: SoundType,
    },
    /// `Base.Member`
    Qualified {
        base: NameId,
        member: NameId,
    },
    Union(SoundType, SoundType),
    Intersect(SoundType, SoundType),
    /// An instance of a class whose `extends` clause names this type.
    InstanceOfSubclass(SoundType),
    /// `Element[]`
    Array(SoundType),
    /// A type literal, an interface or the instances of a class. `base` says
    /// which tags it allows, and has the members that `members`, an index into
    /// [`ModuleTypes::member_lists`], does not.
    Object {
        base: SoundType,
        members: u32,
    },
    /// Something callable that returns this.
    Function(SoundType),
}

/// A type and the module whose table it indexes.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Located {
    /// 0 for the module being parsed, else 1 + an index into `Resolver::keep_alive`.
    module: u32,
    pub ty: SoundType,
}

impl Located {
    pub const TOP: Located = Located {
        module: 0,
        ty: SoundType::TOP,
    };

    /// A type of the module being parsed.
    #[inline]
    pub const fn own(ty: SoundType) -> Located {
        Located { module: 0, ty }
    }

    #[inline]
    pub const fn from_mask(m: Mask) -> Located {
        Located::own(SoundType::from_mask(m))
    }

    #[inline]
    pub const fn is_top(self) -> bool {
        self.ty.is_top()
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DeclKind {
    Alias,
    Interface,
    Class,
    Enum,
}

#[derive(Copy, Clone)]
enum Decl {
    None,
    Type {
        kind: DeclKind,
        ty: SoundType,
    },
    Import {
        specifier: u32,
        imported: NameId,
    },
    ImportStar {
        specifier: u32,
    },
    /// Declared in a way this table does not model: in a nested scope, twice
    /// with different meanings, or as a value that shadows a global type.
    Opaque,
}

struct Name {
    text: Box<[u8]>,
    decl: Decl,
    /// Some declaration in the file has a type parameter with this name.
    /// Type parameter scopes are not tracked, so the name is unknown everywhere.
    is_type_parameter: bool,
}

#[derive(Copy, Clone)]
enum Export {
    Local(NameId),
    From { specifier: u32, imported: NameId },
    Namespace,
}

/// The type namespace of one module.
#[derive(Default)]
pub struct ModuleTypes {
    /// Absolute path of the module, for resolving its import specifiers.
    pub path: Box<[u8]>,
    names: Vec<Name>,
    name_ids: StringHashMap<u32>,
    nodes: Vec<Node>,
    member_lists: Vec<Box<[(NameId, SoundType)]>>,
    specifiers: Vec<Box<[u8]>>,
    exports: HashMap<NameId, Export>,
    export_stars: Vec<u32>,
}

impl ModuleTypes {
    pub fn new(path: &[u8]) -> ModuleTypes {
        ModuleTypes {
            path: Box::from(path),
            ..Default::default()
        }
    }

    pub fn intern(&mut self, text: &[u8]) -> NameId {
        if let Some(&id) = self.name_ids.get(text) {
            return NameId(id);
        }
        let id = self.names.len() as u32;
        self.names.push(Name {
            text: Box::from(text),
            decl: Decl::None,
            is_type_parameter: false,
        });
        bun_core::handle_oom(self.name_ids.put(text, id));
        NameId(id)
    }

    #[inline]
    fn lookup(&self, text: &[u8]) -> Option<NameId> {
        self.name_ids.get(text).map(|&id| NameId(id))
    }

    #[inline]
    fn name(&self, id: NameId) -> &Name {
        &self.names[id.0 as usize]
    }

    fn add_node(&mut self, node: Node) -> SoundType {
        let index = self.nodes.len() as u32;
        debug_assert!(index < SoundType::ANY.0);
        self.nodes.push(node);
        SoundType(index | SoundType::NODE_BIT)
    }

    fn add_specifier(&mut self, specifier: &[u8]) -> u32 {
        if let Some(last) = self.specifiers.last()
            && **last == *specifier
        {
            return self.specifiers.len() as u32 - 1;
        }
        self.specifiers.push(Box::from(specifier));
        self.specifiers.len() as u32 - 1
    }

    // ── Types ────────────────────────────────────────────────────────────

    pub fn reference(&mut self, name: &[u8], arg0: SoundType) -> SoundType {
        let name = self.intern(name);
        self.add_node(Node::Ref { name, arg0 })
    }

    pub fn qualified(&mut self, base: &[u8], member: &[u8]) -> SoundType {
        let base = self.intern(base);
        let member = self.intern(member);
        self.add_node(Node::Qualified { base, member })
    }

    pub fn union(&mut self, a: SoundType, b: SoundType) -> SoundType {
        if a.is_top() || b.is_top() {
            return SoundType::TOP;
        }
        match (a.as_mask(), b.as_mask()) {
            (Some(a), Some(b)) => SoundType::from_mask(a | b),
            _ => self.add_node(Node::Union(a, b)),
        }
    }

    pub fn intersect(&mut self, a: SoundType, b: SoundType) -> SoundType {
        match (a.as_mask(), b.as_mask()) {
            (Some(a), Some(b)) => SoundType::from_mask(mask::intersect(a, b)),
            _ => self.add_node(Node::Intersect(a, b)),
        }
    }

    pub fn optional(&mut self, ty: SoundType) -> SoundType {
        self.union(ty, SoundType::from_mask(mask::UNDEFINED))
    }

    pub fn instance_of_subclass(&mut self, base: SoundType) -> SoundType {
        self.add_node(Node::InstanceOfSubclass(base))
    }

    pub fn array(&mut self, element: SoundType) -> SoundType {
        if element.is_top() {
            return SoundType::from_mask(mask::ARRAY);
        }
        self.add_node(Node::Array(element))
    }

    pub fn function(&mut self, returns: SoundType) -> SoundType {
        if returns.is_top() {
            return SoundType::from_mask(mask::FUNCTION);
        }
        self.add_node(Node::Function(returns))
    }

    /// `base`, refined with the known types of its members.
    pub fn object(&mut self, base: SoundType, members: Vec<(NameId, SoundType)>) -> SoundType {
        if members.is_empty() || base.is_top() {
            return base;
        }
        let index = self.member_lists.len() as u32;
        self.member_lists.push(members.into_boxed_slice());
        self.add_node(Node::Object {
            base,
            members: index,
        })
    }

    // ── Declarations ─────────────────────────────────────────────────────

    pub fn declare_type_parameter(&mut self, name: &[u8]) {
        let id = self.intern(name);
        self.names[id.0 as usize].is_type_parameter = true;
    }

    /// A name whose meaning as a type this table cannot answer for.
    pub fn declare_opaque(&mut self, name: &[u8]) {
        let id = self.intern(name);
        self.names[id.0 as usize].decl = Decl::Opaque;
    }

    /// A type, interface, class or enum declared in the module scope.
    pub fn declare(&mut self, name: &[u8], kind: DeclKind, ty: SoundType) {
        let id = self.intern(name);
        let merged = match self.names[id.0 as usize].decl {
            Decl::None => Decl::Type { kind, ty },
            // Declaration merging: a value of the merged type satisfies both.
            Decl::Type {
                kind: prev_kind,
                ty: prev_ty,
            } if kind != DeclKind::Alias
                && prev_kind != DeclKind::Alias
                && (kind == DeclKind::Enum) == (prev_kind == DeclKind::Enum) =>
            {
                Decl::Type {
                    kind: prev_kind,
                    ty: self.union(prev_ty, ty),
                }
            }
            _ => Decl::Opaque,
        };
        self.names[id.0 as usize].decl = merged;
    }

    fn declare_import(&mut self, local: &[u8], decl: Decl) {
        let id = self.intern(local);
        let slot = &mut self.names[id.0 as usize].decl;
        *slot = match *slot {
            Decl::None => decl,
            _ => Decl::Opaque,
        };
    }

    /// `import { imported as local } from specifier`; `imported` is `default`
    /// for a default import.
    pub fn declare_import_item(&mut self, local: &[u8], specifier: &[u8], imported: &[u8]) {
        let specifier = self.add_specifier(specifier);
        let imported = self.intern(imported);
        self.declare_import(
            local,
            Decl::Import {
                specifier,
                imported,
            },
        );
    }

    /// `import * as local from specifier`
    pub fn declare_import_star(&mut self, local: &[u8], specifier: &[u8]) {
        let specifier = self.add_specifier(specifier);
        self.declare_import(local, Decl::ImportStar { specifier });
    }

    /// `export { local as exported }`, or an exported declaration.
    pub fn export_local(&mut self, exported: &[u8], local: &[u8]) {
        let exported = self.intern(exported);
        let local = self.intern(local);
        self.exports.insert(exported, Export::Local(local));
    }

    /// `export { imported as exported } from specifier`
    pub fn export_from(&mut self, exported: &[u8], specifier: &[u8], imported: &[u8]) {
        let specifier = self.add_specifier(specifier);
        let exported = self.intern(exported);
        let imported = self.intern(imported);
        self.exports.insert(
            exported,
            Export::From {
                specifier,
                imported,
            },
        );
    }

    /// `export * from specifier`
    pub fn export_star(&mut self, specifier: &[u8]) {
        let specifier = self.add_specifier(specifier);
        self.export_stars.push(specifier);
    }

    /// `export * as exported from specifier`
    pub fn export_star_as(&mut self, exported: &[u8]) {
        let exported = self.intern(exported);
        self.exports.insert(exported, Export::Namespace);
    }

    /// Run once after the parse pass. A module-scope value with the name of a
    /// global type (`const Map = ...`) makes that name opaque.
    pub fn finish(&mut self, is_declared_in_module_scope: impl Fn(&[u8]) -> bool) {
        for name in &mut self.names {
            if matches!(name.decl, Decl::None) && is_declared_in_module_scope(&name.text) {
                name.decl = Decl::Opaque;
            }
        }
    }
}

/// Finds the type tables of other modules.
pub trait ModuleTypesHost {
    /// The table of the module that `specifier` resolves to from `importer`.
    fn module_types(&self, importer: &[u8], specifier: &[u8]) -> Option<Arc<ModuleTypes>>;
}

#[derive(Copy, Clone)]
enum Query<'q> {
    Member(&'q [u8]),
    Element,
    Returns,
}

#[derive(Copy, Clone)]
struct Resolved {
    mask: Mask,
    is_enum: bool,
}

impl Resolved {
    const TOP: Resolved = Resolved {
        mask: mask::TOP,
        is_enum: false,
    };
}

type ModuleKey = usize;

#[inline]
fn module_key(m: &ModuleTypes) -> ModuleKey {
    core::ptr::from_ref(m) as usize
}

/// Evaluates [`SoundType`]s. One per parsed file.
#[derive(Default)]
pub struct Resolver<'h> {
    host: Option<&'h dyn ModuleTypesHost>,
    memo: HashMap<(ModuleKey, NameId), Resolved>,
    in_progress: Vec<(ModuleKey, NameId)>,
    /// `memo` and `modules` key other modules by address.
    keep_alive: Vec<Arc<ModuleTypes>>,
    modules: HashMap<(ModuleKey, u32), Option<usize>>,
    /// With `BUN_SOUND_TYPES_STATS`: a `<how it is declared>\t<name>` line for
    /// each use of a name that allows every value.
    unresolved: Option<Vec<u8>>,
}

const MAX_DEPTH: usize = 48;

impl<'h> Resolver<'h> {
    pub fn new(host: Option<&'h dyn ModuleTypesHost>) -> Resolver<'h> {
        Resolver {
            host,
            unresolved: bun_core::env_var::BUN_SOUND_TYPES_STATS::get().map(|_| Vec::new()),
            ..Default::default()
        }
    }

    // TEMPORARY-ANNOTATION-STATS: how the last name that came to nothing is declared.
    pub fn last_unresolved_kind(&self, since: usize) -> String {
        match &self.unresolved {
            Some(lines) if lines.len() > since => {
                let line = &lines[since..];
                let end = line.iter().position(|&c| c == b'\t').unwrap_or(line.len());
                String::from_utf8_lossy(&line[..end]).into_owned()
            }
            _ => "no name involved".to_owned(),
        }
    }
    pub fn unresolved_len(&self) -> usize {
        self.unresolved.as_ref().map_or(0, Vec::len)
    }

    pub fn take_unresolved(&mut self) -> Option<Vec<u8>> {
        self.unresolved.as_mut().map(core::mem::take)
    }

    /// Never returns 0.
    pub fn resolve(&mut self, m: &ModuleTypes, ty: SoundType) -> Mask {
        if let Some(mask) = ty.as_mask() {
            return mask;
        }
        match m.nodes[ty.node_index()] {
            Node::Ref { name, arg0 } => {
                let resolved = self.resolve_name(m, name, arg0).mask;
                if resolved == mask::TOP
                    && let Some(unresolved) = &mut self.unresolved
                {
                    let name = m.name(name);
                    unresolved.extend_from_slice(match name.decl {
                        _ if name.is_type_parameter => b"type-parameter\t",
                        Decl::None => b"undeclared\t",
                        Decl::Type { .. } => b"declared\t",
                        Decl::Import { .. } | Decl::ImportStar { .. } => b"imported\t",
                        Decl::Opaque => b"opaque\t",
                    });
                    unresolved.extend_from_slice(&name.text);
                    unresolved.push(b'\n');
                }
                resolved
            }
            Node::Qualified { base, member } => self.resolve_qualified(m, base, member),
            Node::Union(a, b) => {
                let a = self.resolve(m, a);
                if a == mask::TOP {
                    return mask::TOP;
                }
                mask::normalize(a | self.resolve(m, b))
            }
            Node::Intersect(a, b) => {
                let a = self.resolve(m, a);
                mask::intersect(a, self.resolve(m, b))
            }
            Node::InstanceOfSubclass(base) => {
                let base = self.resolve(m, base);
                if base == mask::TOP || base & mask::OBJECT == 0 {
                    mask::OBJECT
                } else {
                    base & mask::OBJECT
                }
            }
            Node::Array(_) => mask::ARRAY,
            Node::Object { base, .. } => self.resolve(m, base),
            Node::Function(_) => mask::FUNCTION,
        }
    }

    // ── Structure ────────────────────────────────────────────────────────
    //
    // The queries below return the type that TypeScript assigns to an expression,
    // not its run-time type. Nothing here is verified until a check is emitted.

    fn with_module<R>(
        &mut self,
        own: &ModuleTypes,
        module: u32,
        f: impl FnOnce(&mut Self, &ModuleTypes) -> R,
    ) -> R {
        if module == 0 {
            f(self, own)
        } else {
            let other = self.keep_alive[module as usize - 1].clone();
            f(self, &other)
        }
    }

    pub fn mask_of(&mut self, own: &ModuleTypes, t: Located) -> Mask {
        if let Some(m) = t.ty.as_mask() {
            return m;
        }
        self.with_module(own, t.module, |this, m| this.resolve(m, t.ty))
    }

    /// The type of `<t>.<name>`.
    pub fn member(&mut self, own: &ModuleTypes, t: Located, name: &[u8]) -> Located {
        self.query(own, t, Query::Member(name))
    }

    /// The type of `<t>[<number>]`, assuming that the element exists.
    pub fn element(&mut self, own: &ModuleTypes, t: Located) -> Located {
        self.query(own, t, Query::Element)
    }

    /// The type of `<t>(...)`.
    pub fn returns(&mut self, own: &ModuleTypes, t: Located) -> Located {
        self.query(own, t, Query::Returns)
    }

    fn query(&mut self, own: &ModuleTypes, t: Located, q: Query<'_>) -> Located {
        if t.is_top() {
            return Located::TOP;
        }
        self.with_module(own, t.module, |this, m| this.query_in(m, t.module, t.ty, q, 0))
            .unwrap_or(Located::TOP)
    }

    /// `None` when `ty` says nothing about `q`.
    fn query_in(
        &mut self,
        m: &ModuleTypes,
        module: u32,
        ty: SoundType,
        q: Query<'_>,
        depth: usize,
    ) -> Option<Located> {
        if depth >= MAX_DEPTH || ty.is_top() {
            return None;
        }
        if let Some(bits) = ty.as_mask() {
            return match q {
                Query::Member(b"length") if bits & !(mask::STRING | mask::ARRAY) == 0 => {
                    Some(Located::from_mask(mask::NUMBER))
                }
                Query::Element if bits == mask::STRING => Some(Located::from_mask(mask::STRING)),
                _ => None,
            };
        }
        let at = |ty: SoundType| Located { module, ty };
        match m.nodes[ty.node_index()] {
            Node::Ref { name, arg0 } => self.query_name(m, module, name, arg0, q, depth + 1),
            Node::Qualified { .. } => None,
            Node::Union(a, b) => {
                // A member of `T | null` is read where the value is a `T`.
                let is_nullish = |t: SoundType| {
                    t.as_mask()
                        .is_some_and(|bits| bits & !(mask::NULL | mask::UNDEFINED) == 0)
                };
                if is_nullish(a) {
                    return self.query_in(m, module, b, q, depth + 1);
                }
                if is_nullish(b) {
                    return self.query_in(m, module, a, q, depth + 1);
                }
                let a = self.query_in(m, module, a, q, depth + 1)?;
                let b = self.query_in(m, module, b, q, depth + 1)?;
                if a == b {
                    return Some(a);
                }
                // The tags survive, the structure does not. (A type of module 0
                // that is not a mask can only have been found in module 0: `m`.)
                let bits = self.mask_of(m, a) | self.mask_of(m, b);
                (mask::normalize(bits) != mask::TOP).then(|| Located::from_mask(bits))
            }
            Node::Intersect(a, b) => self
                .query_in(m, module, a, q, depth + 1)
                .or_else(|| self.query_in(m, module, b, q, depth + 1)),
            Node::InstanceOfSubclass(base) => self.query_in(m, module, base, q, depth + 1),
            Node::Array(element) => match q {
                Query::Element => Some(at(element)),
                Query::Member(b"length") => Some(Located::from_mask(mask::NUMBER)),
                _ => None,
            },
            Node::Object { base, members } => {
                if let Query::Member(name) = q
                    && let Some(id) = m.lookup(name)
                    && let Some(&(_, found)) = m.member_lists[members as usize]
                        .iter()
                        .find(|(member, _)| *member == id)
                {
                    return (!found.is_top()).then(|| at(found));
                }
                self.query_in(m, module, base, q, depth + 1)
            }
            Node::Function(returns) => match q {
                Query::Returns => Some(at(returns)),
                _ => None,
            },
        }
    }

    fn query_name(
        &mut self,
        m: &ModuleTypes,
        module: u32,
        id: NameId,
        arg0: SoundType,
        q: Query<'_>,
        depth: usize,
    ) -> Option<Located> {
        let name = m.name(id);
        if name.is_type_parameter || depth >= MAX_DEPTH {
            return None;
        }
        match name.decl {
            Decl::None => match (GLOBAL_TYPES.get(&*name.text).copied()?, q) {
                (GlobalType::ArrayOfArg0, Query::Element) => {
                    (!arg0.is_top()).then_some(Located { module, ty: arg0 })
                }
                (GlobalType::ArrayOfArg0 | GlobalType::TypedArray(..), Query::Member(b"length")) => {
                    Some(Located::from_mask(mask::NUMBER))
                }
                (GlobalType::TypedArray(_, element), Query::Element) => {
                    Some(Located::from_mask(element))
                }
                (GlobalType::SubsetOfArg0 | GlobalType::NonNullableArg0, _)
                    if &*name.text != b"Partial" =>
                {
                    self.query_in(m, module, arg0, q, depth + 1)
                }
                _ => None,
            },
            Decl::Type { ty, .. } => self.query_in(m, module, ty, q, depth + 1),
            Decl::Import {
                specifier,
                imported,
            } => {
                let other = self.module_index(m, specifier)?;
                let imported: Box<[u8]> = m.name(imported).text.clone();
                self.query_export(other, &imported, q, depth + 1)
            }
            Decl::ImportStar { .. } | Decl::Opaque => None,
        }
    }

    fn query_export(
        &mut self,
        module: usize,
        exported: &[u8],
        q: Query<'_>,
        depth: usize,
    ) -> Option<Located> {
        if depth >= MAX_DEPTH {
            return None;
        }
        let m = self.keep_alive[module].clone();
        let id = m.lookup(exported)?;
        match *m.exports.get(&id)? {
            Export::Local(local) => {
                self.query_name(&m, module as u32 + 1, local, SoundType::TOP, q, depth + 1)
            }
            Export::Namespace => None,
            Export::From {
                specifier,
                imported,
            } => {
                let other = self.module_index(&m, specifier)?;
                let imported: Box<[u8]> = m.name(imported).text.clone();
                self.query_export(other, &imported, q, depth + 1)
            }
        }
    }

    fn module_index(&mut self, importer: &ModuleTypes, specifier: u32) -> Option<usize> {
        self.module(importer, specifier)?;
        *self.modules.get(&(module_key(importer), specifier))?
    }

    fn resolve_name(&mut self, m: &ModuleTypes, id: NameId, arg0: SoundType) -> Resolved {
        let name = m.name(id);
        if name.is_type_parameter {
            return Resolved::TOP;
        }
        let decl = name.decl;
        match decl {
            Decl::None => Resolved {
                mask: self.resolve_global(m, &name.text, arg0),
                is_enum: false,
            },
            Decl::Opaque | Decl::ImportStar { .. } => Resolved::TOP,
            Decl::Type { .. } | Decl::Import { .. } => {
                let key = (module_key(m), id);
                if let Some(found) = self.memo.get(&key) {
                    return *found;
                }
                if self.in_progress.len() >= MAX_DEPTH || self.in_progress.contains(&key) {
                    return Resolved::TOP;
                }
                self.in_progress.push(key);
                let resolved = match decl {
                    Decl::Type { kind, ty } => Resolved {
                        mask: self.resolve(m, ty),
                        is_enum: kind == DeclKind::Enum,
                    },
                    Decl::Import {
                        specifier,
                        imported,
                    } => self
                        .module(m, specifier)
                        .and_then(|other| {
                            self.resolve_export(&other, &m.name(imported).text, &mut Vec::new())
                        })
                        .unwrap_or(Resolved::TOP),
                    _ => unreachable!(),
                };
                self.in_progress.pop();
                self.memo.insert(key, resolved);
                resolved
            }
        }
    }

    fn resolve_qualified(&mut self, m: &ModuleTypes, base: NameId, member: NameId) -> Mask {
        let name = m.name(base);
        if name.is_type_parameter {
            return mask::TOP;
        }
        match name.decl {
            // `Enum.Member`
            Decl::Type { .. } | Decl::Import { .. } => {
                let resolved = self.resolve_name(m, base, SoundType::TOP);
                if resolved.is_enum {
                    resolved.mask
                } else {
                    mask::TOP
                }
            }
            // `ns.Type`
            Decl::ImportStar { specifier } => {
                if self.in_progress.len() >= MAX_DEPTH {
                    return mask::TOP;
                }
                let Some(other) = self.module(m, specifier) else {
                    return mask::TOP;
                };
                // Bounds `import * as self` cycles; not a key `resolve_name` uses.
                self.in_progress.push((module_key(m), base));
                let resolved = self.resolve_export(&other, &m.name(member).text, &mut Vec::new());
                self.in_progress.pop();
                resolved.map_or(mask::TOP, |r| r.mask)
            }
            Decl::None | Decl::Opaque => mask::TOP,
        }
    }

    /// `None` when `m` has no export called `exported`.
    fn resolve_export(
        &mut self,
        m: &ModuleTypes,
        exported: &[u8],
        visited_stars: &mut Vec<ModuleKey>,
    ) -> Option<Resolved> {
        if let Some(id) = m.lookup(exported)
            && let Some(&export) = m.exports.get(&id)
        {
            return Some(match export {
                Export::Local(local) => self.resolve_name(m, local, SoundType::TOP),
                Export::Namespace => Resolved::TOP,
                Export::From {
                    specifier,
                    imported,
                } => {
                    let key = (module_key(m), id);
                    if self.in_progress.len() >= MAX_DEPTH || self.in_progress.contains(&key) {
                        return Some(Resolved::TOP);
                    }
                    let other = self.module(m, specifier)?;
                    self.in_progress.push(key);
                    let resolved =
                        self.resolve_export(&other, &m.name(imported).text, &mut Vec::new());
                    self.in_progress.pop();
                    resolved.unwrap_or(Resolved::TOP)
                }
            });
        }
        if exported == b"default" {
            return None;
        }
        if visited_stars.contains(&module_key(m)) {
            return None;
        }
        visited_stars.push(module_key(m));
        for i in 0..m.export_stars.len() {
            if let Some(other) = self.module(m, m.export_stars[i])
                && let Some(found) = self.resolve_export(&other, exported, visited_stars)
            {
                return Some(found);
            }
        }
        None
    }

    fn module(&mut self, importer: &ModuleTypes, specifier: u32) -> Option<Arc<ModuleTypes>> {
        let host = self.host?;
        let key = (module_key(importer), specifier);
        if let Some(found) = self.modules.get(&key) {
            return found.map(|i| self.keep_alive[i].clone());
        }
        let found = host.module_types(&importer.path, &importer.specifiers[specifier as usize]);
        let index = found.as_ref().map(|module| {
            self.keep_alive.push(module.clone());
            self.keep_alive.len() - 1
        });
        self.modules.insert(key, index);
        found
    }

    fn resolve_global(&mut self, m: &ModuleTypes, name: &[u8], arg0: SoundType) -> Mask {
        match GLOBAL_TYPES.get(name).copied() {
            None => mask::TOP,
            Some(GlobalType::Mask(mask)) => mask,
            Some(GlobalType::ArrayOfArg0) => mask::ARRAY,
            Some(GlobalType::TypedArray(kind, _)) => mask::typed_array(kind),
            Some(GlobalType::SubsetOfArg0) => self.resolve(m, arg0),
            Some(GlobalType::NonNullableArg0) => {
                mask::normalize(self.resolve(m, arg0) & mask::NON_NULLISH)
            }
        }
    }
}

#[derive(Copy, Clone)]
enum GlobalType {
    Mask(Mask),
    /// Every value of `Name<T, ...>` is a value of `T`, or has the tags of one.
    SubsetOfArg0,
    NonNullableArg0,
    /// `Name<Element>`
    ArrayOfArg0,
    /// Which (see [`mask::typed_array`]), and the tags of its elements.
    TypedArray(u32, Mask),
}

/// Whether the parser has to evaluate `T` in `name<T, ...>`.
#[inline]
pub fn takes_first_type_argument(name: &[u8]) -> bool {
    matches!(
        GLOBAL_TYPES.get(name),
        Some(GlobalType::SubsetOfArg0 | GlobalType::NonNullableArg0 | GlobalType::ArrayOfArg0)
    )
}

const INSTANCE: GlobalType = GlobalType::Mask(mask::OTHER_OBJECT);

bun_core::comptime_string_map! {
    static GLOBAL_TYPES: GlobalType = {
        b"Array" => GlobalType::ArrayOfArg0,
        b"ReadonlyArray" => GlobalType::ArrayOfArg0,
        b"Function" => GlobalType::Mask(mask::FUNCTION),
        b"Object" => GlobalType::Mask(mask::NON_NULLISH),
        b"Record" => GlobalType::Mask(mask::OBJECT),
        b"Pick" => GlobalType::Mask(mask::OBJECT),
        b"Omit" => GlobalType::Mask(mask::OBJECT),
        b"PromiseLike" => GlobalType::Mask(mask::OBJECT),
        b"Uppercase" => GlobalType::Mask(mask::STRING),
        b"Lowercase" => GlobalType::Mask(mask::STRING),
        b"Capitalize" => GlobalType::Mask(mask::STRING),
        b"Uncapitalize" => GlobalType::Mask(mask::STRING),
        b"PropertyKey" => GlobalType::Mask(mask::PROPERTY_KEY),

        b"Readonly" => GlobalType::SubsetOfArg0,
        b"Partial" => GlobalType::SubsetOfArg0,
        b"Required" => GlobalType::SubsetOfArg0,
        b"Exclude" => GlobalType::SubsetOfArg0,
        b"Extract" => GlobalType::SubsetOfArg0,
        b"NonNullable" => GlobalType::NonNullableArg0,

        b"Promise" => INSTANCE,
        b"Map" => INSTANCE,
        b"Set" => INSTANCE,
        b"ReadonlyMap" => INSTANCE,
        b"ReadonlySet" => INSTANCE,
        b"WeakMap" => INSTANCE,
        b"WeakSet" => INSTANCE,
        b"WeakRef" => INSTANCE,
        b"Date" => INSTANCE,
        b"RegExp" => INSTANCE,
        b"Error" => INSTANCE,
        b"TypeError" => INSTANCE,
        b"RangeError" => INSTANCE,
        b"SyntaxError" => INSTANCE,
        b"ReferenceError" => INSTANCE,
        b"EvalError" => INSTANCE,
        b"URIError" => INSTANCE,
        b"AggregateError" => INSTANCE,
        b"ArrayBuffer" => INSTANCE,
        b"SharedArrayBuffer" => INSTANCE,
        b"DataView" => INSTANCE,
        b"Int8Array" => GlobalType::TypedArray(0, mask::NUMBER),
        b"Uint8Array" => GlobalType::TypedArray(1, mask::NUMBER),
        b"Uint8ClampedArray" => GlobalType::TypedArray(2, mask::NUMBER),
        b"Int16Array" => GlobalType::TypedArray(3, mask::NUMBER),
        b"Uint16Array" => GlobalType::TypedArray(4, mask::NUMBER),
        b"Int32Array" => GlobalType::TypedArray(5, mask::NUMBER),
        b"Uint32Array" => GlobalType::TypedArray(6, mask::NUMBER),
        b"Float16Array" => GlobalType::TypedArray(7, mask::NUMBER),
        b"Float32Array" => GlobalType::TypedArray(8, mask::NUMBER),
        b"Float64Array" => GlobalType::TypedArray(9, mask::NUMBER),
        b"BigInt64Array" => GlobalType::TypedArray(10, mask::BIGINT),
        b"BigUint64Array" => GlobalType::TypedArray(11, mask::BIGINT),
        b"Buffer" => GlobalType::TypedArray(1, mask::NUMBER),
        b"URL" => INSTANCE,
        b"URLSearchParams" => INSTANCE,
        b"AbortSignal" => INSTANCE,
        b"AbortController" => INSTANCE,
    };
}

bun_core::comptime_string_set! {
    /// Properties every string, number, boolean, symbol or bigint has. An
    /// object type with only these members accepts primitives:
    /// `const x: { length: number } = "abc"`.
    static PRIMITIVE_MEMBERS = {
        b"constructor",
        b"toString",
        b"toLocaleString",
        b"valueOf",
        b"hasOwnProperty",
        b"isPrototypeOf",
        b"propertyIsEnumerable",
        b"length",
        b"at",
        b"charAt",
        b"charCodeAt",
        b"codePointAt",
        b"concat",
        b"endsWith",
        b"includes",
        b"indexOf",
        b"lastIndexOf",
        b"localeCompare",
        b"match",
        b"matchAll",
        b"normalize",
        b"padEnd",
        b"padStart",
        b"repeat",
        b"replace",
        b"replaceAll",
        b"search",
        b"slice",
        b"split",
        b"startsWith",
        b"substring",
        b"substr",
        b"toLowerCase",
        b"toUpperCase",
        b"toLocaleLowerCase",
        b"toLocaleUpperCase",
        b"trim",
        b"trimEnd",
        b"trimStart",
        b"trimLeft",
        b"trimRight",
        b"isWellFormed",
        b"toWellFormed",
        b"toFixed",
        b"toExponential",
        b"toPrecision",
        b"description",
    };
}

/// What the parser learns about `{ ... }` in a type position while skipping it.
pub struct ObjectTypeShape {
    /// The members whose types say something.
    pub members: Vec<(NameId, SoundType)>,
    pub has_call_signature: bool,
    /// No member rules out a primitive. True for `{}`.
    pub accepts_primitives: bool,
    /// `{ [K in keyof T]: ... }`, which is `T` itself when `T` is a primitive.
    pub is_homomorphic_mapped_type: bool,
}

impl Default for ObjectTypeShape {
    fn default() -> Self {
        Self {
            members: Vec::new(),
            has_call_signature: false,
            accepts_primitives: true,
            is_homomorphic_mapped_type: false,
        }
    }
}

impl ObjectTypeShape {
    #[inline]
    pub fn add_member(&mut self, name: &[u8]) {
        if !PRIMITIVE_MEMBERS.contains(name) {
            self.accepts_primitives = false;
        }
    }

    pub fn type_literal_mask(&self) -> Mask {
        if self.is_homomorphic_mapped_type {
            mask::TOP
        } else if self.has_call_signature {
            mask::FUNCTION
        } else {
            self.interface_mask()
        }
    }

    /// An interface can merge with or extend declarations this shape has not seen.
    pub fn interface_mask(&self) -> Mask {
        if self.accepts_primitives && !self.has_call_signature {
            mask::NON_NULLISH
        } else {
            mask::OBJECT
        }
    }
}

/// Why a check exists. Indexes [`Stats::by_rule`].
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Rule {
    Param,
    Return,
    VarInit,
    VarAssign,
    Cast,
    NonNull,
    FieldInit,
    FieldStore,
    FieldRead,
    Call,
    /// A member or an element of something that is not `this`.
    Read,
    /// What a `for`-`of` goes through.
    Iterated,
}

impl Rule {
    pub const COUNT: usize = 12;
    pub const NAMES: [&'static str; Rule::COUNT] = [
        "param",
        "return",
        "var-init",
        "var-assign",
        "cast",
        "non-null",
        "field-init",
        "field-store",
        "field-read",
        "call",
        "read",
        "iterated",
    ];
}

/// Process-wide counts of emitted checks, for measuring a build.
/// EXPERIMENT (`BUN_SOUND_TYPES_ORACLE`): what a full type checker says of the
/// expressions of the program, for finding out what it would be worth to have
/// one. A table made ahead of time (`~/code/tmp/aot/tsoracle/FORMAT.md`) goes
/// from a byte offset that is peculiar to the expression (its anchor) to a mask.
/// It is consulted only where this front end has nothing to say.
pub mod oracle {
    use super::{Mask, mask};
    use std::collections::HashMap;
    use std::sync::OnceLock;

    pub type Entries = &'static [(u32, u32)];

    struct File {
        len: u32,
        hash: u32,
        entries: Vec<(u32, u32)>,
    }

    struct Table {
        root: Vec<u8>,
        files: HashMap<Vec<u8>, File>,
        keeps_objects: bool,
    }

    static TABLE: OnceLock<Option<Table>> = OnceLock::new();
    /// The types at positions in the sources, which the printer emits as type tags
    /// (`js_printer::Options::type_tags`): a map from an anchor to a type number. For now the table is generated
    /// ahead of time (`BUN_SOUND_TYPES_TAGS`). A type checker that runs after the linker will produce it later.
    static TAGS: OnceLock<Option<Table>> = OnceLock::new();

    fn load() -> Option<Table> {
        load_table("BUN_SOUND_TYPES_ORACLE", b"TSOR")
    }

    pub fn tags_for(path: &[u8], contents: &[u8]) -> Option<Entries> {
        let table: &'static Table = TAGS
            .get_or_init(|| load_table("BUN_SOUND_TYPES_TAGS", b"TSTG"))
            .as_ref()?;
        let file = path
            .strip_prefix(table.root.as_slice())
            .and_then(|relative| table.files.get(relative));
        let same = file.is_some_and(|f| f.len as usize == contents.len() && f.hash == fnv1a32(contents));
        note_lookup(table, path, contents, if same { "same" } else if file.is_some() { "differs" } else { "unknown" });
        if !same {
            return None;
        }
        Some(file?.entries.as_slice())
    }

    /// TEMPORARY: logs each file that tags were requested for, and the outcome (BUN_SOUND_TYPES_TAGS_LOG=<file>), and dumps
    /// the text of the files that have changed since the table was generated (BUN_SOUND_TYPES_TAGS_DUMP=<directory>).
    fn note_lookup(table: &Table, path: &[u8], contents: &[u8], what: &str) {
        use std::io::Write;
        static SEEN: std::sync::Mutex<Option<std::collections::HashSet<Vec<u8>>>> = std::sync::Mutex::new(None);
        let Some(log) = std::env::var_os("BUN_SOUND_TYPES_TAGS_LOG") else {
            return;
        };
        let mut seen = SEEN.lock().unwrap();
        if !seen.get_or_insert_with(Default::default).insert(path.to_vec()) {
            return;
        }
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
            let _ = writeln!(file, "{}\t{}\t{}", what, contents.len(), String::from_utf8_lossy(path));
        }
        if what != "differs" {
            return;
        }
        let (Some(directory), Some(relative)) = (
            std::env::var_os("BUN_SOUND_TYPES_TAGS_DUMP"),
            path.strip_prefix(table.root.as_slice()),
        ) else {
            return;
        };
        let to = std::path::Path::new(&directory).join(String::from_utf8_lossy(relative).as_ref());
        if let Some(parent) = to.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(to, contents);
    }

    fn load_table(variable: &str, magic: &[u8; 4]) -> Option<Table> {
        let path = std::env::var_os(variable)?;
        let mut root = std::env::var_os("BUN_SOUND_TYPES_ORACLE_ROOT")?
            .into_encoded_bytes();
        if root.last() != Some(&b'/') {
            root.push(b'/');
        }
        let bytes = std::fs::read(path).ok()?;
        let mut at = 0usize;
        let word = |at: &mut usize| -> Option<u32> {
            let w = u32::from_le_bytes(bytes.get(*at..*at + 4)?.try_into().ok()?);
            *at += 4;
            Some(w)
        };
        if bytes.get(0..4)? != magic {
            return None;
        }
        at += 4;
        if word(&mut at)? != 1 {
            return None;
        }
        let count = word(&mut at)?;
        let mut files = HashMap::new();
        for _ in 0..count {
            let path_len = word(&mut at)? as usize;
            let name = bytes.get(at..at + path_len)?.to_vec();
            at += (path_len + 3) & !3;
            let len = word(&mut at)?;
            let hash = word(&mut at)?;
            let entry_count = word(&mut at)? as usize;
            let mut entries = Vec::with_capacity(entry_count);
            for _ in 0..entry_count {
                let anchor = word(&mut at)?;
                let m = word(&mut at)?;
                entries.push((anchor, m));
            }
            files.insert(name, File { len, hash, entries });
        }
        Some(Table {
            root,
            files,
            keeps_objects: std::env::var_os("BUN_SOUND_TYPES_ORACLE_OBJECTS").is_some(),
        })
    }

    fn fnv1a32(bytes: &[u8]) -> u32 {
        let mut h = 0x811c_9dc5u32;
        for &b in bytes {
            h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
        h
    }

    /// The table's entries for the file, if its contents still match the ones the table was generated from.
    pub fn entries_for(path: &[u8], contents: &[u8]) -> Option<Entries> {
        let table: &'static Table = TABLE.get_or_init(load).as_ref()?;
        let file = table.files.get(path.strip_prefix(table.root.as_slice())?)?;
        if file.len as usize != contents.len() || file.hash != fnv1a32(contents) {
            return None;
        }
        Some(file.entries.as_slice())
    }

    /// Whether to emit checks that a value is an object, which this front end
    /// omits by default.
    pub fn keeps_objects() -> bool {
        TABLE.get_or_init(load).as_ref().is_some_and(|t| t.keeps_objects)
    }

    /// Whether a value typed as, for example, Map is checked to be a Map, rather than
    /// just an object. (TypeScript accepts anything that is structurally compatible.)
    pub fn keeps_kinds() -> bool {
        static KEEPS: OnceLock<bool> = OnceLock::new();
        *KEEPS.get_or_init(|| std::env::var_os("BUN_SOUND_TYPES_ORACLE_KINDS").is_some())
    }

    /// Returns `TOP` if the table has no entry.
    pub fn mask_at(entries: Entries, anchor: i32) -> Mask {
        let Ok(anchor) = u32::try_from(anchor) else {
            return mask::TOP;
        };
        let Ok(i) = entries.binary_search_by_key(&anchor, |e| e.0) else {
            return mask::TOP;
        };
        let raw = entries[i].1 & !(3 << 30);
        let mut m = raw;
        if m & mask::PLAIN_OBJECT != 0 || (m & mask::KINDS_OF_OBJECT != 0 && !keeps_kinds()) {
            m |= mask::OTHER_OBJECT;
        }
        mask::normalize(m)
    }
}

pub mod stats {
    use core::sync::atomic::{AtomicU32, Ordering};

    use super::{Rule, mask};

    /// By what `$$t` is passed, of which there are far fewer than there are masks.
    static COUNTS: [[AtomicU32; mask::WIRE_END as usize]; Rule::COUNT] =
        [const { [const { AtomicU32::new(0) }; mask::WIRE_END as usize] }; Rule::COUNT];

    pub fn add(checks: &[(Rule, super::Mask)]) {
        for &(rule, m) in checks {
            if let Some(wire) = mask::to_wire(m) {
                COUNTS[rule as usize][wire as usize].fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    // TEMPORARY-ANNOTATION-STATS
    static NAMED: std::sync::Mutex<Option<std::collections::HashMap<String, u32>>> =
        std::sync::Mutex::new(None);

    pub fn is_requested() -> bool {
        bun_core::env_var::BUN_SOUND_TYPES_STATS::get().is_some()
    }

    pub fn bump(name: String) {
        *NAMED
            .lock()
            .unwrap()
            .get_or_insert_with(Default::default)
            .entry(name)
            .or_insert(0) += 1;
    }

    /// Appends to `${BUN_SOUND_TYPES_STATS}.unresolved`.
    pub fn append_unresolved(lines: &[u8]) {
        let Some(path) = bun_core::env_var::BUN_SOUND_TYPES_STATS::get() else {
            return;
        };
        if lines.is_empty() {
            return;
        }
        let path = [path, b".unresolved"].concat();
        let _ = bun_sys::File::openat(
            bun_sys::Fd::cwd(),
            &path,
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::APPEND,
            0o644,
        )
        .and_then(|file| file.write_all(lines));
    }

    /// Honors `BUN_SOUND_TYPES_STATS`.
    pub fn write_if_requested() {
        if let Some(path) = bun_core::env_var::BUN_SOUND_TYPES_STATS::get() {
            let _ = bun_sys::File::create(bun_sys::Fd::cwd(), path, true)
                .and_then(|file| file.write_all(&to_json()));
            let mut lines = String::new();
            if let Some(named) = NAMED.lock().unwrap().as_ref() {
                for (name, count) in named {
                    lines.push_str(&format!("{count}\t{name}\n"));
                }
            }
            let path = [path, b".named"].concat();
            let _ = bun_sys::File::create(bun_sys::Fd::cwd(), &path, true)
                .and_then(|file| file.write_all(lines.as_bytes()));
        }
    }

    /// `{"<rule>": {"<mask>": count, ...}, ...}`
    fn to_json() -> Vec<u8> {
        use std::io::Write as _;
        let mut out = Vec::new();
        out.push(b'{');
        for (rule, by_mask) in COUNTS.iter().enumerate() {
            if rule > 0 {
                out.push(b',');
            }
            let _ = write!(out, "\"{}\":{{", Rule::NAMES[rule]);
            let mut first = true;
            for (m, count) in by_mask.iter().enumerate() {
                let count = count.load(Ordering::Relaxed);
                if count == 0 {
                    continue;
                }
                if !first {
                    out.push(b',');
                }
                first = false;
                let _ = write!(out, "\"{m}\":{count}");
            }
            out.push(b'}');
        }
        out.extend_from_slice(b"}\n");
        out
    }
}

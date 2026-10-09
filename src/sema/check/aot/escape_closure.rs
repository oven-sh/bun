//! Escape analysis of objects, and the field facts that rest on it.
//!
//! UNTYPED CODE is whatever may do to an object what no type says: code of the program that holds it as `any`, `unknown`, `object` or
//! `{}`, JavaScript modules, the host, a built-in. A layout has ESCAPED if untyped code may hold a reference to one of its objects.
//! The engine holds a store from untyped code to the TYPE of the field, so types stay true whatever escapes. WHICH function a field
//! holds has no such guard: another function of the right type is stored like any other. So "this field holds that function" is a fact
//! only for layouts that have not escaped, all of whose stores are therefore seen.
//!
//! It is type-based and flow-insensitive: a graph of implications between `Node`s, which say something of an object type, of the declaration
//! of a signature or of a type parameter. Nothing else has a name beyond its file, so no other type has to outlive the task.
//! Everything here only ever WITHHOLDS a fact: nothing goes back into the subtype sets, the flags of the views or the types of the
//! translated program.
//!
//! **Polarity.** `let_out(T)`: a value of type `T` gets to untyped code. An object type escapes. Of a function type the result is let out, and
//! the parameters and `this` are let in. `let_in(T)`: untyped code puts a value where `T` is expected. The engine tests an object on
//! the way in: it is of the type, or plain data that is COPIED into a layout of the type, whose members are then let in. Of a function
//! it only tests that it is one: the function type is TAINTED, a place of it may
//! hold a function that is not typed code. Typed code will call that, so the parameters of a tainted function type are let out and
//! its result is let in. What a container holds goes both ways either way. A type parameter LEAKS.
//!
//! **Seeds.** Every expression of a file is asked where its value goes: `Checker::place_entered_by`, whose matches over `Parent`, `ExprKind` and
//! `StmtKind` have no wildcard arm. A form that nobody has decided does not compile.
//!
//! **Carried flows.** A function of type `F1 = (a: A1) => R1` that enters a place of type `F2 = (a: A2) => R2` is called with an `A2` and yields an
//! `R1` where an `R2` is expected. If untyped code is the caller, or the function, no typed place is in between. So each such flow makes
//! edges: if `R2` escapes so does `R1`, and if `F1` is tainted so is `F2`, whatever the two take: methods are compared bivariantly, and a
//! function may be taken for one with more parameters.
//!
//! **Size.** What a type lets through is walked once for each file and stands behind one `Node::Joint`, so a flow is one edge however many parts
//! the two types have. Nothing is noted for a pair of parts.
//!
//! **Closed** when the program is linked, after the subtype sets are final: `EscapeClosure::close`.

use super::alterations::Alterations;
use super::builtins_generated::{Arity, BUILTIN_ENTRIES, BuiltinEntry, BuiltinKind, Pattern, uses};
use super::callees::Callee;
use super::flows::{Membership, Place};
use super::trust::{ALIASES, TYPED_ARRAYS};
use crate::atom::Atom;
use crate::bind::{Decl, Parent, SymFlags};
use crate::check::{Checker, ContextFlags};
use crate::hir::{BinOp, CallId, ExprId, ExprKind, ExprTag, FileKind, FnId, PropKind, StmtKind, TypeParamId, UnOp};
use crate::program::{FileId, Sym};
use crate::types::{ComponentsId, Follow, MapperId, Origin, PropSource, SigId, TypeData, TypeId, Visitor};
use crate::util::{FxHashMap, FxHashSet};
use std::hash::Hash;
use std::rc::Rc;
use std::sync::OnceLock;

/// A type parameter, by its declaration.
pub(super) type TypeParameter = (FileId, TypeParamId);

/// Something that may come to hold. `T`: what an object type is called by. The object types are `laid_out_as`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum Node<T = TypeId> {
    /// Untyped code may hold a reference to an object that is in a place of the type.
    Escaped(T),
    /// Untyped code puts an object where one of the type is expected.
    CopiedInto(T),
    /// A place of the type may hold an object that is not laid out: `Reach::admits_foreign`. Where that goes on to a place of another type,
    /// it is made one of that: copied into a layout of it.
    AdmitsUntyped(T),
    /// A place of a function type may hold a function that is not typed code. By where the signature is declared: all that is made of it by
    /// putting types in for type parameters is one.
    Tainted(FileId, FnId),
    /// A value whose type is the type parameter gets to untyped code, or is written to.
    Leaking(TypeParameter),
    /// It stands between others. Numbered within the file.
    Joint(FileId, u32),
}

impl<T> Node<T> {
    fn renamed<U>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Option<Node<U>> {
        Some(match self {
            Node::Escaped(ty) => Node::Escaped(rename(ty)?),
            Node::CopiedInto(ty) => Node::CopiedInto(rename(ty)?),
            Node::AdmitsUntyped(ty) => Node::AdmitsUntyped(rename(ty)?),
            Node::Tainted(file, function) => Node::Tainted(file, function),
            Node::Leaking(parameter) => Node::Leaking(parameter),
            Node::Joint(file, number) => Node::Joint(file, number),
        })
    }
}

/// By what kind of way something gets to untyped code, or comes from it: for whoever asks why so much has escaped.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Door {
    /// An argument for a parameter of a function of the program that nothing is said of.
    UntypedParameterOfTheProgram,
    /// An argument of a function that a declaration file of a package or of the host declares.
    ArgumentOfAPackage,
    /// An argument of a built-in: the table has no entry, or says that anything may be done with it, or `lib.*.d.ts` says nothing of the place.
    ArgumentOfABuiltIn,
    ArgumentOfJavaScript,
    /// An argument of a call of which it is not known what it calls.
    ArgumentOfAnUnresolvedCall,
    /// The receiver of a call of a function that is not typed code.
    Receiver,
    /// `as any` and the like.
    Assertion,
    /// Stored, returned, yielded or put into a literal where nothing is said of the place.
    UntypedPlace,
    Thrown,
    /// A value that nothing is said of enters a typed place.
    FromUntyped,
    /// Within a flow between two types: a parameter, a result, an element or a member of the one that nothing is said of.
    Carried,
    /// `MOST_NESTED_FLOWS`.
    TooDeep,
    /// An object is looked at as a type that a package declares.
    TypeOfAPackage,
    /// `MOST_PAIRS_OF_PARTS`.
    LargeUnion,
    /// A signature that no declaration names.
    UndeclaredSignature,
    /// What JavaScript imports from TypeScript.
    ImportedByJavaScript,
    /// A store through a type parameter, the `arguments` object.
    Other,
    /// C2.
    ViewAdmitsUntyped,
    /// C4.
    FieldHoldsUnknownFunction,
    DirectEval,
}

/// What has been noted for the closure.
pub(crate) struct Escapes<T = TypeId> {
    /// What a built-in may freeze or give another prototype: see `alterations.rs`.
    pub(super) alterations: Alterations<T>,
    /// The nodes that `seeds` and `edges` number. One may be there twice.
    nodes: Vec<Node<T>>,
    /// Of the nodes that have been numbered since this was made, or absorbed. It is not kept with what is handed on.
    number_of: FxHashMap<Node<T>, u32>,
    /// What holds, with a place that it is seen at.
    seeds: Vec<(u32, Place, Door)>,
    /// If the first holds, so does the second. One may be there twice.
    edges: Vec<(u32, u32)>,
    /// `Object.assign(target, source)`, `{ ...source }`: what the fields of the first hold is stored to the fields of the second by the same
    /// names.
    copies_fields: FxHashSet<(T, T)>,
    /// A store to a field of an object of the type that is not seen as one: by a computed key, a built-in, `delete`, a pattern. `Atom::NONE`:
    /// to any field.
    opened_fields: FxHashMap<(T, Atom), Place>,
    /// A direct `eval`: all is let out.
    everything: Option<Place>,
}

impl<T> Default for Escapes<T> {
    fn default() -> Escapes<T> {
        Escapes {
            alterations: Alterations::default(),
            nodes: Vec::new(),
            number_of: FxHashMap::default(),
            seeds: Vec::new(),
            edges: Vec::new(),
            copies_fields: FxHashSet::default(),
            opened_fields: FxHashMap::default(),
            everything: None,
        }
    }
}

fn keep_least<K: Eq + Hash>(places: &mut FxHashMap<K, Place>, key: K, at: Place) {
    let first = places.entry(key).or_insert(at);
    *first = at.min(*first);
}

impl<T: Copy + Eq + Hash> Escapes<T> {
    fn number(&mut self, node: Node<T>) -> u32 {
        *self.number_of.entry(node).or_insert_with(|| {
            self.nodes.push(node);
            self.nodes.len() as u32 - 1
        })
    }

    fn add_seed(&mut self, node: Node<T>, at: Place, door: Door) {
        let node = self.number(node);
        self.seeds.push((node, at, door));
    }

    fn add_edge(&mut self, from: Node<T>, to: Node<T>) {
        let edge = (self.number(from), self.number(to));
        self.edges.push(edge);
    }

    pub(super) fn absorb(&mut self, other: Escapes<T>) {
        self.alterations.absorb(other.alterations);
        let numbers: Vec<u32> = other.nodes.into_iter().map(|node| self.number(node)).collect();
        self.seeds.extend(other.seeds.into_iter().map(|(node, at, door)| (numbers[node as usize], at, door)));
        self.edges.extend(other.edges.into_iter().map(|(from, to)| (numbers[from as usize], numbers[to as usize])));
        self.copies_fields.extend(other.copies_fields);
        for (field, at) in other.opened_fields {
            keep_least(&mut self.opened_fields, field, at);
        }
        self.everything = match (self.everything, other.everything) {
            (Some(at), Some(also_at)) => Some(at.min(also_at)),
            (at, also_at) => at.or(also_at),
        };
    }

    pub(super) fn renamed<U: Copy + Eq + Hash>(self, rename: &mut impl FnMut(T) -> Option<U>) -> Escapes<U> {
        let mut out = Escapes::default();
        let numbers: Vec<Option<u32>> = self.nodes.into_iter().map(|node| node.renamed(rename).map(|node| out.number(node))).collect();
        out.seeds = self.seeds.into_iter().filter_map(|(node, at, door)| Some((numbers[node as usize]?, at, door))).collect();
        out.edges = self.edges.into_iter().filter_map(|(from, to)| Some((numbers[from as usize]?, numbers[to as usize]?))).collect();
        out.number_of = FxHashMap::default();
        for ((ty, name), at) in self.opened_fields {
            if let Some(ty) = rename(ty) {
                keep_least(&mut out.opened_fields, (ty, name), at);
            }
        }
        out.alterations = self.alterations.renamed(rename);
        out.copies_fields = self.copies_fields.into_iter().filter_map(|(from, to)| Some((rename(from)?, rename(to)?))).collect();
        out.everything = self.everything;
        out
    }
}

/// What one walk over a type has found.
#[derive(Default)]
pub(super) struct LetThrough {
    /// The object types that are let out, `laid_out_as`.
    pub(super) escaped: Vec<TypeId>,
    /// The function types that are let in.
    pub(super) tainted: Vec<TypeId>,
    /// The object types that are let in, `laid_out_as`.
    pub(super) copied_into: Vec<TypeId>,
    pub(super) leaks: Vec<TypeParameter>,
    seen: FxHashSet<(TypeId, bool)>,
}

/// See `Checker::let_through_for_closure`.
pub struct ForClosure {
    /// The edges that the members of the views make.
    noted: Escapes,
    /// By view: what holds once the members of its objects are read and called. And once they are written.
    members_out: Vec<Option<Node>>,
    members_in: Vec<Option<Node>>,
    /// `EscapeClosure::by_door` is wanted.
    is_explained: bool,
}

/// What is asked of a type: `Checker::node_for`.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Asked {
    /// Holds: a value of the type gets to untyped code.
    LetOut,
    /// Holds: untyped code puts a value where the type is expected.
    LetIn,
    /// The same of the members of an object of the type.
    MembersLetOut,
    MembersLetIn,
    /// Comes to hold once anything does that is let out with the type.
    AnyLetOut,
    /// Comes to hold if a view among the parts of the type admits untyped objects.
    AnyAdmitsUntyped,
}

/// Where the value of an expression goes.
enum Entered {
    /// It is used up where it stands: tested, converted, called, read from.
    Nowhere,
    /// It is, or is among, what the expression around it yields, whose type has the type of this one in it.
    WithParent,
    /// A place of this type.
    Typed(TypeId),
    Untyped,
    /// What it holds goes to untyped code, and it does not itself.
    PartsUntyped,
}

/// What is known of the function that a call calls.
#[derive(Copy, Clone)]
enum CalleeKind {
    /// A function of the program, or whatever is in a place of a function type: it goes by the signature.
    Typed,
    /// The engine implements it: the interface of `lib.*.d.ts` that declares it, `NONE` for a global, and the name.
    BuiltIn(Atom, Atom),
    Unknown,
}

/// What has been noted for the file that is gone through. What is noted goes with the module, and a module that is not in the program is
/// dropped: nothing is left out for a file because another has noted it.
pub(super) struct State {
    file: FileId,
    /// Of the expression that is looked at.
    door: Door,
    joints: u32,
    nodes: FxHashMap<(TypeId, Asked), Option<Node>>,
    /// The pairs of types between which a flow has been noted.
    flows: FxHashSet<(TypeId, TypeId)>,
    /// The same for `note_entering_type_parameters`.
    pub(super) entered: FxHashSet<(TypeId, TypeId)>,
    /// The instantiations and the signatures whose type arguments have been noted.
    bound: FxHashSet<TypeId>,
    bound_at_calls: FxHashSet<SigId>,
    /// The signatures of which it has been noted what follows if they are tainted, or is about to be.
    expanded: FxHashSet<SigId>,
    to_expand: Vec<SigId>,
    /// By what is called, and by call: it is asked for each argument.
    callees: FxHashMap<ExprId, CalleeKind>,
    uses: FxHashMap<CallId, Option<(u16, Rc<[u16]>)>>,
    untyped_callbacks: FxHashMap<CallId, bool>,
}

impl State {
    fn of_file(file: FileId) -> State {
        State {
            file,
            door: Door::Other,
            joints: 0,
            nodes: FxHashMap::default(),
            flows: FxHashSet::default(),
            entered: FxHashSet::default(),
            bound: FxHashSet::default(),
            bound_at_calls: FxHashSet::default(),
            expanded: FxHashSet::default(),
            to_expand: Vec::new(),
            callees: FxHashMap::default(),
            uses: FxHashMap::default(),
            untyped_callbacks: FxHashMap::default(),
        }
    }
}

impl Default for State {
    /// For the link, which goes through the views: no file has this number.
    fn default() -> State {
        State::of_file(FileId(u32::MAX))
    }
}

/// The entries of `BUILTIN_ENTRIES` for the holder and the name, of whatever kind: those of one built-in are adjacent.
fn entries_of(holder: &str, name: &[u8]) -> &'static [BuiltinEntry] {
    static INDEX: OnceLock<FxHashMap<(&'static str, &'static [u8]), (usize, usize)>> = OnceLock::new();
    let index = INDEX.get_or_init(|| {
        let mut index: FxHashMap<(&'static str, &'static [u8]), (usize, usize)> = FxHashMap::default();
        for (at, entry) in BUILTIN_ENTRIES.iter().enumerate() {
            index.entry((entry.holder, entry.name.as_bytes())).or_insert((at, at)).1 = at + 1;
        }
        index
    });
    index.get(&(holder, name)).map_or(&[], |&(from, to)| &BUILTIN_ENTRIES[from..to])
}

/// The holder as `BUILTIN_ENTRIES` spells it.
fn holder_named(text: &[u8]) -> Option<&'static str> {
    static HOLDERS: OnceLock<FxHashMap<&'static [u8], &'static str>> = OnceLock::new();
    HOLDERS.get_or_init(|| BUILTIN_ENTRIES.iter().map(|entry| (entry.holder.as_bytes(), entry.holder)).collect()).get(text).copied()
}

/// As many flows may carry a flow within them.
const MOST_NESTED_FLOWS: u32 = 3;

/// As many pairs of parts of two unions are looked at one by one.
const MOST_PAIRS_OF_PARTS: usize = 64;

/// The types and the mappers that the record of a type refers to.
#[derive(Default)]
struct Mentioned {
    types: Vec<TypeId>,
    mappers: Vec<MapperId>,
}

impl Visitor for Mentioned {
    fn atom(&mut self, _: Atom) {}
    fn components(&mut self, _: ComponentsId) {}
    fn mapper(&mut self, id: MapperId) {
        self.mappers.push(id);
    }
    fn sig(&mut self, _: SigId) {}
    fn ty(&mut self, id: TypeId) {
        self.types.push(id);
    }
    fn file(&mut self, _: FileId) {}
    fn plain<T: Hash + ?Sized>(&mut self, _: &T) {}
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── the walk over a type ─────────────────────────────

    /// `is_out`: `let_out`, else `let_in`. See the head of the file.
    pub(super) fn let_through(&mut self, ty: TypeId, is_out: bool, found: &mut LetThrough) {
        let ty = self.reduced(ty);
        if self.says_nothing(ty) || self.has_primitive_flag(ty) && !matches!(self.data(ty), TypeData::Union(_)) || !found.seen.insert((ty, is_out)) {
            return;
        }
        if matches!(self.data(ty), TypeData::Union(_)) {
            for &part in self.parts(ty) {
                self.let_through(part, is_out, found);
            }
            return;
        }
        if let TypeData::TypeParam(file, parameter, _) = *self.data(ty) {
            found.leaks.push((file, parameter));
            return;
        }
        if self.is_instantiable(ty) {
            // `T[K]`, a deferred conditional type: whatever is put in for a type parameter in it may be what it stands for.
            self.add_type_parameters_in(ty, &mut found.leaks);
            let bound = self.base_constraint(ty);
            if bound != ty {
                self.let_through(bound, is_out, found);
            }
            return;
        }
        if let TypeData::Intersection(parts) = self.data(ty) {
            let parts: Vec<TypeId> = parts.iter().copied().collect();
            for part in parts {
                self.let_through(part, is_out, found);
            }
        }
        if is_out {
            self.let_signatures_through(ty, true, found);
        } else if !self.signatures(ty, false).is_empty() || !self.signatures(ty, true).is_empty() {
            // What comes of that: `let_signatures_through`, when the program is linked.
            found.tainted.push(ty);
        }
        // What a container holds is read and written by whoever has the container.
        if matches!(self.data(ty), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
            for &argument in self.type_arguments(ty) {
                self.let_through(argument, true, found);
                self.let_through(argument, false, found);
            }
        }
        for key in [TypeId::NUMBER, TypeId::STRING] {
            if let Some(held) = self.index_type_of_type(ty, key) {
                self.let_through(held, true, found);
                self.let_through(held, false, found);
            }
        }
        if self.says_properties(ty) {
            let view = self.laid_out_as(ty);
            if is_out { &mut found.escaped } else { &mut found.copied_into }.push(view);
        } else if !self.is_array_or_tuple(ty) {
            // A namespace object, the static side of a class, an enum object: no view stands for it, so its members are gone through here.
            self.let_members_through_one_way(ty, true, found);
            self.let_members_through_one_way(ty, false, found);
        }
    }

    /// `is_out`: untyped code calls a function of the type. Else typed code calls a function in a place of the type that is not typed code.
    fn let_signatures_through(&mut self, ty: TypeId, is_out: bool, found: &mut LetThrough) {
        for constructs in [false, true] {
            for &signature in self.signatures(ty, constructs).iter() {
                let parameters = self.sig_params(signature);
                for index in 0..parameters.len() {
                    if let Some(parameter) = self.param_type_at(&parameters, index) {
                        self.let_through(parameter, !is_out, found);
                    }
                }
                if let Some(this) = self.sig_this_type(signature) {
                    self.let_through(this, !is_out, found);
                }
                let result = self.sig_return(signature);
                self.let_through(result, is_out, found);
            }
        }
    }

    fn add_type_parameters_in(&mut self, ty: TypeId, out: &mut Vec<TypeParameter>) {
        let (mut seen, mut pending) = (FxHashSet::default(), vec![ty]);
        while let Some(at) = pending.pop() {
            if !seen.insert(at) {
                continue;
            }
            if let TypeData::TypeParam(file, parameter, _) = *self.data(at) {
                out.push((file, parameter));
                continue;
            }
            let mut mentioned = Mentioned::default();
            self.data(at).visit(&mut mentioned);
            for mapper in mentioned.mappers {
                if mapper != MapperId::IDENTITY {
                    pending.extend(self.types().mapping(mapper).iter().map(|pair| pair.1));
                }
            }
            pending.extend(mentioned.types);
        }
    }

    // ───────────────────────────── notes ─────────────────────────────

    fn note_seed(&mut self, node: Option<Node>, at: Place, door: Door) {
        if let Some(node) = node {
            self.escapes_noted().add_seed(node, at, door);
        }
    }

    fn note_edge(&mut self, from: Option<Node>, to: Option<Node>) {
        if let (Some(from), Some(to)) = (from, to)
            && from != to
        {
            self.escapes_noted().add_edge(from, to);
        }
    }

    fn new_joint(&mut self) -> Node {
        let state = &mut self.aot.escape_closure;
        state.joints += 1;
        Node::Joint(state.file, state.joints - 1)
    }

    /// The node for the signature. `None`: no declaration names it, so it is taken to be tainted from the start.
    fn node_for_signature(&mut self, signature: SigId) -> Option<Node> {
        let state = &mut self.aot.escape_closure;
        if state.expanded.insert(signature) {
            state.to_expand.push(signature);
        }
        self.sig_decl(signature).map(|(file, function, _)| Node::Tainted(file, function))
    }

    /// What follows if a signature is tainted: typed code calls a function that is not typed code with what the parameters say, and takes what
    /// it yields for what the result says. One after the other and not one within the other: a signature leads to others without end.
    fn expand_signatures(&mut self) {
        while let Some(signature) = self.aot.escape_closure.to_expand.pop() {
            let parameters = self.sig_params(signature);
            let mut follows: Vec<Option<Node>> = Vec::new();
            for index in 0..parameters.len() {
                if let Some(parameter) = self.param_type_at(&parameters, index) {
                    follows.push(self.node_for(parameter, Asked::LetOut));
                }
            }
            if let Some(this) = self.sig_this_type(signature) {
                follows.push(self.node_for(this, Asked::LetOut));
            }
            let result = self.sig_return(signature);
            follows.push(self.node_for(result, Asked::LetIn));
            match self.sig_decl(signature) {
                Some((file, function, _)) => {
                    for node in follows {
                        self.note_edge(Some(Node::Tainted(file, function)), node);
                    }
                }
                None => {
                    let at = Place { file: self.aot.escape_closure.file, pos: 0 };
                    for node in follows {
                        self.note_seed(node, at, Door::UndeclaredSignature);
                    }
                }
            }
        }
    }

    /// The node that stands for what is asked of the type. `None`: nothing comes of it. The type is walked once for a file.
    fn node_for(&mut self, ty: TypeId, asked: Asked) -> Option<Node> {
        let ty = self.reduced(ty);
        if let Some(&known) = self.aot.escape_closure.nodes.get(&(ty, asked)) {
            return known;
        }
        let mut found = LetThrough::default();
        match asked {
            Asked::AnyAdmitsUntyped => {
                let parts: Vec<TypeId> = self.parts(ty).to_vec();
                for part in parts {
                    if self.says_properties(part) {
                        found.copied_into.push(self.laid_out_as(part));
                    }
                }
            }
            Asked::LetOut | Asked::AnyLetOut => self.let_through(ty, true, &mut found),
            Asked::LetIn => self.let_through(ty, false, &mut found),
            Asked::MembersLetOut => self.let_members_through_one_way(ty, true, &mut found),
            Asked::MembersLetIn => self.let_members_through_one_way(ty, false, &mut found),
        }
        let mut nodes: Vec<Node> = found.escaped.into_iter().map(Node::Escaped).chain(found.leaks.into_iter().map(Node::Leaking)).collect();
        if asked == Asked::AnyAdmitsUntyped {
            nodes.extend(found.copied_into.drain(..).map(Node::AdmitsUntyped));
        } else if asked != Asked::AnyLetOut {
            nodes.extend(found.copied_into.into_iter().map(Node::CopiedInto));
            for function in found.tainted {
                for constructs in [false, true] {
                    let signatures: Vec<SigId> = self.signatures(function, constructs).iter().copied().collect();
                    for signature in signatures {
                        nodes.extend(self.node_for_signature(signature));
                    }
                }
            }
        }
        let mut seen: FxHashSet<Node> = FxHashSet::default();
        nodes.retain(|&node| seen.insert(node));
        let node = match nodes[..] {
            [] => None,
            [only] => Some(only),
            _ => {
                let joint = self.new_joint();
                let noted = self.escapes_noted();
                for node in nodes {
                    if matches!(asked, Asked::AnyLetOut | Asked::AnyAdmitsUntyped) {
                        noted.add_edge(node, joint);
                    } else {
                        noted.add_edge(joint, node);
                    }
                }
                Some(joint)
            }
        };
        self.aot.escape_closure.nodes.insert((ty, asked), node);
        node
    }

    fn note_let_through(&mut self, ty: TypeId, is_out: bool, at: Place) {
        let node = self.node_for(ty, if is_out { Asked::LetOut } else { Asked::LetIn });
        let door = self.aot.escape_closure.door;
        self.note_seed(node, at, door);
        self.expand_signatures();
    }

    /// What the members of the objects of the type let out and in: C1, C2.
    fn note_parts_let_out(&mut self, ty: TypeId, at: Place) {
        let door = self.aot.escape_closure.door;
        for asked in [Asked::MembersLetOut, Asked::MembersLetIn] {
            let node = self.node_for(ty, asked);
            self.note_seed(node, at, door);
        }
        self.expand_signatures();
    }

    /// Whoever has an object of the type reads its members and calls them, `is_out`, and writes them.
    fn let_members_through_one_way(&mut self, ty: TypeId, is_out: bool, found: &mut LetThrough) {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        for part in parts {
            if self.has_primitive_flag(part) || self.says_nothing(part) {
                continue;
            }
            if self.is_instantiable(part) {
                self.add_type_parameters_in(part, &mut found.leaks);
                continue;
            }
            let Some(members) = self.members(part) else { continue };
            for prop in members.shape().props.iter() {
                let of_member = self.type_of_prop(prop, members.mapper);
                self.let_through(of_member, is_out, found);
            }
            if matches!(self.data(part), TypeData::Ref { .. } | TypeData::Tuple { .. }) {
                for &argument in self.type_arguments(part) {
                    self.let_through(argument, is_out, found);
                }
            }
            for key in [TypeId::NUMBER, TypeId::STRING] {
                if let Some(held) = self.index_type_of_type(part, key) {
                    self.let_through(held, is_out, found);
                }
            }
        }
    }

    /// What `EscapeClosure::close` needs of the types: for each of the views what reading and what writing the members of its objects leads to.
    pub fn let_through_for_closure(&mut self, views: &[TypeId], is_explained: bool) -> ForClosure {
        let noted_so_far = std::mem::take(self.escapes_noted());
        self.aot.escape_closure = State::default();
        let members_out: Vec<Option<Node>> = views.iter().map(|&view| self.node_for(view, Asked::MembersLetOut)).collect();
        let members_in: Vec<Option<Node>> = views.iter().map(|&view| self.node_for(view, Asked::MembersLetIn)).collect();
        self.expand_signatures();
        self.aot.escape_closure = State::default();
        let noted = std::mem::replace(self.escapes_noted(), noted_so_far);
        ForClosure { noted, members_out, members_in, is_explained }
    }

    /// A value of type `source` enters a place of type `target`.
    fn note_flow(&mut self, source: TypeId, target: TypeId, at: Place) {
        self.note_flow_within(source, target, at, 0);
        self.expand_signatures();
    }

    /// `depth`: how many flows carry this one within them.
    fn note_flow_within(&mut self, source: TypeId, target: TypeId, at: Place, depth: u32) {
        // There is no value of type `never`: the elements of `[]`.
        if source == target || source.is_never() || target.is_never() || !self.aot.escape_closure.flows.insert((source, target)) {
            return;
        }
        self.note_entering_type_parameters(source, target);
        let (says_nothing, is_said_nothing_of) = (self.says_nothing_of_objects(target), self.says_nothing_of_objects(source));
        // What the members of a generic type yield is made of that type again, without end: `optional(): Optional<this>`. From here on the
        // value is taken to go through untyped code, which can do all that a typed flow does.
        let is_too_deep = depth > MOST_NESTED_FLOWS;
        let door = |at_once: Door| if says_nothing || is_said_nothing_of { if depth == 0 { at_once } else { Door::Carried } } else { Door::TooDeep };
        if says_nothing || is_too_deep {
            let node = self.node_for(source, Asked::LetOut);
            self.note_seed(node, at, door(self.aot.escape_closure.door));
        }
        if is_said_nothing_of && !says_nothing || is_too_deep {
            let node = self.node_for(target, Asked::LetIn);
            self.note_seed(node, at, door(Door::FromUntyped));
        }
        if says_nothing || is_said_nothing_of || is_too_deep {
            return;
        }
        // Whoever has what is in a place of the target has what has come from the source.
        self.note_escapes_with(target, source);
        // An object that is not laid out is made one of the target.
        let (admits, is_made) = (self.node_for(source, Asked::AnyAdmitsUntyped), self.node_for(target, Asked::LetIn));
        self.note_edge(admits, is_made);
        self.note_carried_flows(source, target, at, depth);
    }

    /// `any`, `unknown`, `object`, `{}`, `Object`, `Function`, `void`: whoever has a value of it as that may do anything to it.
    pub(super) fn says_nothing_of_objects(&mut self, ty: TypeId) -> bool {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        self.says_nothing(ty) || parts.into_iter().any(|part| self.says_nothing(part) && !part.is_never() || part == TypeId::OBJECT || !self.is_instantiable(part) && self.admits_primitives(part) || self.is_the_function_type(part))
    }

    fn is_the_function_type(&mut self, ty: TypeId) -> bool {
        [crate::atom::known::Function, crate::atom::known::CallableFunction, crate::atom::known::NewableFunction].into_iter().any(|name| ty == self.global_ref(name, &[]))
    }

    /// The flows that a flow between two types that both say something carries within it.
    fn note_carried_flows(&mut self, source: TypeId, target: TypeId, at: Place, depth: u32) {
        let to_parts: Vec<TypeId> = self.parts(target).iter().copied().filter(|&part| !self.has_primitive_flag(part)).collect();
        // A part that both have stays in a place of its own type: what is left of a union that has been narrowed.
        let in_target: FxHashSet<TypeId> = to_parts.iter().copied().collect();
        let from_parts: Vec<TypeId> = self.parts(source).iter().copied().filter(|part| !self.has_primitive_flag(*part) && !in_target.contains(part)).collect();
        if from_parts.len() * to_parts.len() <= MOST_PAIRS_OF_PARTS {
            for &from in &from_parts {
                for &to in &to_parts {
                    self.note_carried_between(from, to, at, depth);
                }
            }
            return;
        }
        // Of two large unions the parts are matched by what declares them. Which part any other is taken for is not looked for: if it
        // carries anything, it is let through.
        let mut by_declaration: FxHashMap<Sym, Vec<TypeId>> = FxHashMap::default();
        for &to in &to_parts {
            if let TypeData::Ref { target: declared, .. } = *self.data(to) {
                by_declaration.entry(declared).or_default().push(to);
            }
        }
        for from in from_parts {
            let matching = match *self.data(from) {
                TypeData::Ref { target: declared, .. } => by_declaration.get(&declared).cloned().unwrap_or_default(),
                _ => Vec::new(),
            };
            if matching.is_empty() {
                for asked in [Asked::LetOut, Asked::LetIn] {
                    let node = self.node_for(from, asked);
                    self.note_seed(node, at, Door::LargeUnion);
                }
            }
            for to in matching {
                self.note_carried_between(from, to, at, depth);
            }
        }
    }

    /// `from`, `to`: neither is a union.
    fn note_carried_between(&mut self, from: TypeId, to: TypeId, at: Place, depth: u32) {
        if let (TypeData::Ref { target: declared, .. }, TypeData::Ref { target: as_declared, .. }) = (self.data(from), self.data(to))
            && declared == as_declared
        {
            let pairs: Vec<(TypeId, TypeId)> = self.type_arguments(from).iter().copied().zip(self.type_arguments(to).iter().copied()).collect();
            for (held, held_as) in pairs {
                self.note_held_together(held, held_as, at, depth);
            }
            return;
        }
        for key in [TypeId::NUMBER, TypeId::STRING] {
            if let (Some(held), Some(held_as)) = (self.index_type_of_type(from, key), self.index_type_of_type(to, key)) {
                self.note_held_together(held, held_as, at, depth);
            }
        }
        self.note_flows_of_function_members(from, to, at, depth);
        for constructs in [false, true] {
            let called_as_all: Vec<SigId> = self.signatures(to, constructs).iter().copied().collect();
            let declared_as_all: Vec<SigId> = self.signatures(from, constructs).iter().copied().collect();
            for &called_as in &called_as_all {
                let arguments = self.sig_params(called_as);
                for &declared_as in &declared_as_all {
                    let parameters = self.sig_params(declared_as);
                    for index in 0..parameters.len() {
                        if let (Some(argument), Some(parameter)) = (self.param_type_at(&arguments, index), self.param_type_at(&parameters, index)) {
                            self.note_flow_within(argument, parameter, at, depth + 1);
                        }
                    }
                    let (yielded, yielded_as) = (self.sig_return(declared_as), self.sig_return(called_as));
                    self.note_flow_within(yielded, yielded_as, at, depth + 1);
                    // If the one is tainted, so is the other.
                    let (of_declared, of_called) = (self.node_for_signature(declared_as), self.node_for_signature(called_as));
                    match of_declared {
                        Some(_) => self.note_edge(of_declared, of_called),
                        None => self.note_seed(of_called, at, Door::UndeclaredSignature),
                    }
                }
            }
        }
    }

    /// An object of type `from` is looked at as `to` says. A function in a member of it is read as the one type and stored as the other. What
    /// else the members hold is seen to by the subtype sets.
    fn note_flows_of_function_members(&mut self, from: TypeId, to: TypeId, at: Place, depth: u32) {
        if !self.says_properties(from) || !self.says_properties(to) {
            return;
        }
        // A type that a package declares is not gone into. What is looked at as one is for the package: the members of what the program
        // declares are let through, and of the other what is put in for its type parameters.
        let by_package = [from, to].map(|ty| self.is_declared_by_a_package(ty));
        if by_package[0] || by_package[1] {
            for (ty, is_by_package) in [from, to].into_iter().zip(by_package) {
                if !is_by_package {
                    for asked in [Asked::MembersLetOut, Asked::MembersLetIn] {
                        let node = self.node_for(ty, asked);
                        self.note_seed(node, at, Door::TypeOfAPackage);
                    }
                } else if matches!(self.data(ty), TypeData::Ref { .. }) {
                    let arguments: Vec<TypeId> = self.type_arguments(ty).to_vec();
                    for argument in arguments {
                        for asked in [Asked::LetOut, Asked::LetIn] {
                            let node = self.node_for(argument, asked);
                            self.note_seed(node, at, Door::TypeOfAPackage);
                        }
                    }
                }
            }
            return;
        }
        let (Some(of_from), Some(of_to)) = (self.members(from), self.members(to)) else { return };
        for as_prop in of_to.shape().props.iter() {
            let Some(prop) = of_from.resolved.prop(as_prop.name) else { continue };
            // One declaration, as where the one type extends the other: one type.
            if let (&PropSource::Symbol(declared), &PropSource::Symbol(as_declared)) = (&prop.source, &as_prop.source)
                && declared == as_declared
                && of_from.mapper == of_to.mapper
            {
                continue;
            }
            let (held, held_as) = (self.type_of_prop(prop, of_from.mapper), self.type_of_prop(as_prop, of_to.mapper));
            let may_be_function = |this: &mut Self, ty: TypeId| this.parts(ty).to_vec().into_iter().any(|part| !this.signatures(part, false).is_empty() || !this.signatures(part, true).is_empty());
            if held != held_as && may_be_function(self, held) && may_be_function(self, held_as) {
                self.note_held_together(held, held_as, at, depth);
            }
        }
    }

    /// Values of the two types are in one place as far as untyped code goes: an element of an array that is looked at as two types, an
    /// argument. If the one escapes, so does the other.
    fn note_held_together(&mut self, one: TypeId, other: TypeId, at: Place, depth: u32) {
        self.note_flow_within(one, other, at, depth + 1);
        self.note_flow_within(other, one, at, depth + 1);
    }

    /// Whether a declaration file that is not of the language declares the type: a package, the host.
    fn is_declared_by_a_package(&self, ty: TypeId) -> bool {
        let declared_in = match *self.data(ty) {
            TypeData::Ref { target, .. } => target.file,
            TypeData::Anon { origin: Origin::TypeLiteral(file, _) | Origin::Mapped(file, _), .. } => file,
            _ => return false,
        };
        self.hir(declared_in).kind == FileKind::Declaration && !self.files.module(declared_in).is_lib
    }

    /// If something that is let out with `cause` escapes, all is let out that is let out with `effect`.
    fn note_escapes_with(&mut self, cause: TypeId, effect: TypeId) {
        let (cause, effect) = (self.node_for(cause, Asked::AnyLetOut), self.node_for(effect, Asked::LetOut));
        self.note_edge(cause, effect);
    }

    /// The type arguments of the instantiations in the type are put in for the type parameters of what they instantiate.
    fn note_type_arguments_in(&mut self, ty: TypeId) {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        for part in parts {
            let TypeData::Ref { target, .. } = *self.data(part) else { continue };
            if !self.aot.escape_closure.bound.insert(part) {
                continue;
            }
            let parameters: Vec<TypeId> = self.type_params_of_symbol(target).iter().copied().collect();
            let arguments: Vec<TypeId> = self.type_arguments(part).to_vec();
            for (parameter, argument) in parameters.into_iter().zip(arguments) {
                self.note_binding(parameter, argument);
            }
        }
    }

    fn note_binding(&mut self, parameter: TypeId, argument: TypeId) {
        self.note_entering_type_parameters(argument, parameter);
        let TypeData::TypeParam(file, parameter, _) = *self.data(parameter) else { return };
        for asked in [Asked::LetOut, Asked::LetIn] {
            let bound = self.node_for(argument, asked);
            self.note_edge(Some(Node::Leaking((file, parameter))), bound);
        }
        self.expand_signatures();
    }

    // ───────────────────────────── the expressions of a file ─────────────────────────────

    /// Takes note of where the value of every expression of the file goes.
    pub fn note_escapes_in(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Declaration {
            return;
        }
        // Host code, to whatever is found out about the types of the program.
        if self.files.module(file).is_opaque() {
            return;
        }
        self.aot.escape_closure = State::of_file(file);
        if self.is_untyped_file(file) {
            return self.note_escapes_to_javascript(file);
        }
        for index in 0..hir.exprs.len() {
            self.note_escape_of(file, ExprId(index as u32));
        }
    }

    fn note_escape_of(&mut self, file: FileId, e: ExprId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.expr_parent[e.idx()];
        if parent == Parent::None || bound.is_in_type_query(e) {
            return;
        }
        let at = Place { file, pos: hir[e].pos };
        self.aot.escape_closure.door = Door::Other;
        self.note_what_is_done_by(file, e, at);
        self.note_alteration_by(file, e);
        let entered = self.place_entered_by(file, e, parent);
        match entered {
            Entered::Nowhere => {}
            Entered::Typed(target) => self.note_built_in_as_value(file, e, Some(target)),
            Entered::Untyped | Entered::PartsUntyped => self.note_built_in_as_value(file, e, None),
            // A variable, a property, a function without an annotation has the type of what it is given.
            Entered::WithParent => {
                let around = if let Parent::Expr(around) = parent { around } else { e };
                let target = self.type_of_expr(file, around);
                self.note_built_in_as_value(file, e, Some(target));
            }
        }
        if matches!(entered, Entered::Nowhere | Entered::WithParent) {
            return;
        }
        let own = self.type_of_expr(file, e);
        self.aot.escape_closure.door = self.door_of(file, e, parent);
        self.note_type_arguments_in(own);
        match entered {
            Entered::Nowhere | Entered::WithParent => {}
            Entered::Untyped => self.note_let_through(own, true, at),
            Entered::PartsUntyped => self.note_parts_let_out(own, at),
            Entered::Typed(target) => {
                self.note_type_arguments_in(target);
                self.note_flow(own, target, at);
            }
        }
    }

    /// If the value of `e` gets to untyped code where it stands: by what kind of way.
    fn door_of(&mut self, file: FileId, e: ExprId, parent: Parent) -> Door {
        let hir = self.hir(file);
        match parent {
            Parent::Expr(around) => match hir[around].kind {
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if hir[call].callee != e => {
                    let Some(signature) = self.resolved_signature(file, around).sig else { return Door::ArgumentOfAnUnresolvedCall };
                    match self.kind_of_callee(file, hir[call].callee, signature) {
                        CalleeKind::Typed => Door::UntypedParameterOfTheProgram,
                        CalleeKind::BuiltIn(..) => Door::ArgumentOfABuiltIn,
                        CalleeKind::Unknown => match self.sig_decl(signature) {
                            Some((declared_in, ..)) if self.is_untyped_file(declared_in) => Door::ArgumentOfJavaScript,
                            Some((declared_in, ..)) if self.files.module(declared_in).is_lib => Door::ArgumentOfABuiltIn,
                            Some(_) => Door::ArgumentOfAPackage,
                            None => Door::ArgumentOfAnUnresolvedCall,
                        },
                    }
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e => Door::Receiver,
                ExprKind::As { .. } | ExprKind::Satisfies { .. } => Door::Assertion,
                _ => Door::UntypedPlace,
            },
            Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::Throw(_)) => Door::Thrown,
            _ => Door::UntypedPlace,
        }
    }

    /// The type of where the value of `e` goes, as it is declared: a type parameter and not what it is bound by.
    fn declared_contextual_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        self.prepare_enclosing(file, e);
        self.contextual_type(file, e, ContextFlags::empty())
    }

    /// The contextual type, or the place is of the type of the value itself.
    fn contextual_place(&mut self, file: FileId, e: ExprId) -> Entered {
        match self.declared_contextual_type(file, e) {
            Some(target) => Entered::Typed(target),
            None => Entered::WithParent,
        }
    }

    fn place_entered_by(&mut self, file: FileId, e: ExprId, parent: Parent) -> Entered {
        let hir = self.hir(file);
        match parent {
            Parent::None | Parent::File | Parent::Module(_) => Entered::Nowhere,
            Parent::Expr(around) => self.place_in_expression(file, e, around),
            Parent::Stmt(stmt) => match hir[stmt].kind {
                StmtKind::Expr(_) | StmtKind::If { .. } | StmtKind::For { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } | StmtKind::Switch { .. } => Entered::Nowhere,
                // The keys are strings. What is iterated over hands its elements to a binding of their type.
                StmtKind::ForIn { .. } | StmtKind::ForOf { .. } => Entered::Nowhere,
                StmtKind::Return(_) => self.contextual_place(file, e),
                StmtKind::Throw(_) => Entered::Untyped,
                // Whoever imports it has it as its type. The host has the exports of the entry point.
                StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => Entered::Untyped,
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Var(_)
                | StmtKind::Fn(_)
                | StmtKind::Class(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
                | StmtKind::Block(_)
                | StmtKind::Try { .. }
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Labeled { .. }
                | StmtKind::Import(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportAsNamespace(_) => Entered::Untyped,
            },
            Parent::VarInit(_) | Parent::ParamDefault(_) | Parent::PatPropDefault(_) | Parent::PatElemDefault(_) | Parent::MemberInit(_) | Parent::FnBody(_) => self.contextual_place(file, e),
            Parent::Prop(prop) => match hir[prop].kind {
                // `note_what_is_done_by` sees to the literal.
                PropKind::Spread => Entered::Nowhere,
                _ => self.contextual_place(file, e),
            },
            // Converted to a property key.
            Parent::PropKey(..) | Parent::PatKey(_) | Parent::MemberKey(_) | Parent::MethodKey(_) => Entered::Nowhere,
            Parent::EnumInit(_) | Parent::Case(_) => Entered::Nowhere,
            // The class is constructed by what extends it, which is typed code.
            Parent::ClassExtends(_) => Entered::Nowhere,
            Parent::Decorator(..) => Entered::Untyped,
        }
    }

    fn place_in_expression(&mut self, file: FileId, e: ExprId, around: ExprId) -> Entered {
        let hir = self.hir(file);
        match hir[around].kind {
            // These have no operands.
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Object(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_) => Entered::Untyped,
            // Converted to a string, by typed code if by any.
            ExprKind::Template { .. } => Entered::Nowhere,
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
                if hir[call].callee == e {
                    Entered::Nowhere
                } else {
                    self.place_of_argument(file, around, call, e)
                }
            }
            ExprKind::Array(_) => self.contextual_place(file, e),
            // Read from, or stored to: `note_what_is_done_by`. The receiver of a call is handed to what is called.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                if obj == e {
                    self.place_of_receiver(file, e, around)
                } else {
                    Entered::Nowhere
                }
            }
            ExprKind::Unary { op, .. } => match op {
                UnOp::Not | UnOp::Minus | UnOp::Plus | UnOp::BitNot | UnOp::Typeof | UnOp::Void | UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Entered::Nowhere,
            },
            ExprKind::Binary { op, right, .. } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => Entered::WithParent,
                BinOp::Comma if right == e => Entered::WithParent,
                _ => Entered::Nowhere,
            },
            ExprKind::Assign { op, target, value } => {
                if value != e {
                    return Entered::Nowhere;
                }
                match op {
                    None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => match hir[target].kind {
                        // A pattern: its parts go to targets that are not looked at one by one.
                        ExprKind::Array(_) | ExprKind::Object(_) => Entered::PartsUntyped,
                        _ if self.is_place_of_untyped_code(file, target) => Entered::Untyped,
                        _ => Entered::Typed(self.type_of_expr(file, target)),
                    },
                    Some(_) => Entered::Nowhere,
                }
            }
            ExprKind::Cond { test, .. } => {
                if test == e {
                    Entered::Nowhere
                } else {
                    Entered::WithParent
                }
            }
            ExprKind::Spread(_) => match self.bound(file).expr_parent[around.idx()] {
                Parent::Expr(holder) if matches!(hir[holder].kind, ExprKind::Array(_)) => Entered::WithParent,
                _ => Entered::PartsUntyped,
            },
            // What a promise is settled with is of the type it says.
            ExprKind::Await(_) => Entered::Nowhere,
            ExprKind::Yield { .. } => self.contextual_place(file, e),
            ExprKind::As { .. } => {
                // `(namespace as any).Name` reads one binding, and the object goes nowhere else.
                if self.is_namespace_read_by_name(file, e, around) {
                    return Entered::Nowhere;
                }
                Entered::Typed(self.type_of_expr(file, around))
            }
            ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => Entered::WithParent,
            ExprKind::Jsx(_) => Entered::Untyped,
            ExprKind::ImportCall { .. } => Entered::Untyped,
        }
    }

    /// `e`: the name of a namespace import. `cast`: `e as T`. Whether that is the object of `(e as T).Name`, which is not called.
    fn is_namespace_read_by_name(&mut self, file: FileId, e: ExprId, cast: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Ident(name) = hir[e].kind else { return false };
        let Parent::Expr(read) = bound.expr_parent[cast.idx()] else { return false };
        let ExprKind::Dot { obj, .. } = hir[read].kind else { return false };
        if obj != cast {
            return false;
        }
        if let Parent::Expr(user) = bound.expr_parent[read.idx()] {
            match hir[user].kind {
                ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) if hir[call].callee == read => return false,
                ExprKind::Assign { target, .. } if target == read => return false,
                ExprKind::Unary { op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => return false,
                _ => {}
            }
        }
        let Some(sym) = self.resolve_identifier(file, e, name, true).ok().flatten() else { return false };
        self.files.decls_of(sym).iter().all(|&(_, decl)| matches!(decl, Decl::ImportNamespace(_)))
    }

    fn kind_of_callee(&mut self, file: FileId, callee: ExprId, signature: SigId) -> CalleeKind {
        if let Some(&known) = self.aot.escape_closure.callees.get(&callee) {
            return known;
        }
        let kind = self.kind_of_callee_uncached(file, callee, signature);
        self.aot.escape_closure.callees.insert(callee, kind);
        kind
    }

    fn kind_of_callee_uncached(&mut self, file: FileId, callee: ExprId, signature: SigId) -> CalleeKind {
        let Some((declared_in, ..)) = self.sig_decl(signature) else { return CalleeKind::Unknown };
        if self.is_untyped_file(declared_in) {
            return CalleeKind::Unknown;
        }
        // A signature of `lib.*.d.ts`: a built-in, unless it is only the type of a place of the program. The globals of the language are
        // read-only and keep what they have, so what is read from one by name is what the engine put there.
        if self.files.module(declared_in).is_lib
            && let Some((holder, name)) = self.built_in_named_by(file, callee)
            && !entries_of(self.holder_in_table(holder).0, self.atoms().bytes(name)).is_empty()
        {
            return CalleeKind::BuiltIn(holder, name);
        }
        if self.is_predicted(file, callee) || self.files.module(declared_in).is_lib && !self.is_place_of_the_program(file, callee) {
            return CalleeKind::Unknown;
        }
        CalleeKind::Typed
    }

    /// Whether what the expression yields comes out of a place that the program declares, whatever declares the type of that: a variable,
    /// a parameter, a property, an element, what a call yields. Not a property that `lib.*.d.ts` declares, nor a global of it.
    fn is_place_of_the_program(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) => self.resolve_identifier(file, e, name, true).ok().flatten().is_some_and(|sym| !self.files.module(sym.file).is_lib),
            ExprKind::Dot { obj, name, .. } => {
                let receiver = self.type_of_expr(file, obj);
                let receiver = self.non_nullable(receiver);
                let parts: Vec<TypeId> = self.parts(receiver).to_vec();
                parts.into_iter().all(|part| {
                    let apparent = self.apparent_type(part);
                    self.members(apparent).is_some_and(|members| match members.resolved.prop(name).map(|prop| &prop.source) {
                        Some(&crate::types::PropSource::Symbol(declared)) => !self.files.module(declared.file).is_lib,
                        Some(_) => true,
                        None => false,
                    })
                })
            }
            ExprKind::NonNull(inner) | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } => self.is_place_of_the_program(file, inner),
            ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::Fn(_) | ExprKind::Cond { .. } | ExprKind::Binary { .. } | ExprKind::Assign { .. } | ExprKind::Await(_) => true,
            _ => false,
        }
    }

    /// The interface of `lib.*.d.ts` that declares what the expression reads, `NONE` for a global, and the name.
    fn built_in_named_by(&mut self, file: FileId, callee: ExprId) -> Option<(Atom, Atom)> {
        match self.hir(file)[callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                if self.is_predicted(file, obj) {
                    return None;
                }
                let receiver = self.type_of_expr(file, obj);
                let receiver = self.non_nullable(receiver);
                let parts: Vec<TypeId> = self.parts(receiver).to_vec();
                let mut holder = Atom::NONE;
                for part in parts {
                    let apparent = self.apparent_type(part);
                    // What a function has besides its own properties is declared by the interfaces for functions.
                    let is_function = !self.signatures(part, false).is_empty() || !self.signatures(part, true).is_empty();
                    let of_functions = [crate::atom::known::CallableFunction, crate::atom::known::NewableFunction, crate::atom::known::Function].map(|name| self.global_ref(name, &[]));
                    let declared = [apparent].into_iter().chain(of_functions.into_iter().filter(|_| is_function)).find_map(|holding| {
                        self.members(holding).and_then(|members| match members.resolved.prop(name)?.source {
                            crate::types::PropSource::Symbol(declared) => Some(declared),
                            _ => None,
                        })
                    });
                    match declared.filter(|declared| self.files.module(declared.file).is_lib).and_then(|declared| self.holder_of(declared)) {
                        Some(found) if holder.is_none() || holder == found || self.holder_in_table(holder).0 == self.holder_in_table(found).0 => holder = found,
                        _ => return None,
                    }
                }
                holder.is_some().then_some((holder, name))
            }
            ExprKind::Ident(name) => {
                let sym = self.resolve_identifier(file, callee, name, true).ok().flatten()?;
                self.files.module(sym.file).is_lib.then_some((Atom::NONE, name))
            }
            _ => None,
        }
    }

    fn place_of_argument(&mut self, file: FileId, call_expr: ExprId, call: CallId, e: ExprId) -> Entered {
        let hir = self.hir(file);
        if matches!(hir[e].kind, ExprKind::Spread(_)) {
            return Entered::Nowhere;
        }
        let Some(signature) = self.resolved_signature(file, call_expr).sig else { return Entered::Untyped };
        match self.kind_of_callee(file, hir[call].callee, signature) {
            CalleeKind::Unknown => Entered::Untyped,
            CalleeKind::Typed => {
                self.note_type_arguments_of_call(signature);
                self.note_argument_entering_declared_parameter(file, call, e, signature);
                match self.declared_contextual_type(file, e) {
                    Some(target) => Entered::Typed(target),
                    None => Entered::Untyped,
                }
            }
            CalleeKind::BuiltIn(holder, name) => {
                let index = hir.ids(hir[call].args).position(|argument| argument == e).unwrap_or(usize::MAX);
                let is_constructed = matches!(hir[call_expr].kind, ExprKind::New(_));
                let used = self.uses_by_built_in(file, call, holder, name, is_constructed).map_or(uses::EVERYTHING, |found| found.1.get(index).copied().unwrap_or(uses::EVERYTHING));
                self.place_of_operand_of_built_in(file, call_expr, call, e, used, self.is_field_writer(holder, name))
            }
        }
    }

    /// The contextual type of an argument has what is inferred put in for the type parameters. The parameter as it is declared may be of one.
    fn note_argument_entering_declared_parameter(&mut self, file: FileId, call: CallId, e: ExprId, signature: SigId) {
        let hir = self.hir(file);
        let Some((declared_in, function, _)) = self.sig_decl(signature) else { return };
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        let Some(index) = arguments.iter().position(|&argument| argument == e) else { return };
        if arguments[..index].iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return;
        }
        let Some(parameter) = self.hir(declared_in)[function].params.iter().nth(index) else { return };
        let (own, declared) = (self.type_of_expr(file, e), self.type_of_param(declared_in, parameter));
        self.note_entering_type_parameters(own, declared);
    }

    /// What is put in for the type parameters of the function that is called.
    fn note_type_arguments_of_call(&mut self, signature: SigId) {
        let Some((.., mapper)) = self.sig_decl(signature) else { return };
        if mapper == MapperId::IDENTITY || !self.aot.escape_closure.bound_at_calls.insert(signature) {
            return;
        }
        let pairs: Vec<(TypeId, TypeId)> = self.types().mapping(mapper).iter().map(|pair| (pair.0, pair.1)).collect();
        for (parameter, argument) in pairs {
            self.note_binding(parameter, argument);
        }
    }

    /// The name of the holder in `BUILTIN_ENTRIES`, and whether it is the static side.
    fn holder_in_table(&self, holder: Atom) -> (&'static str, bool) {
        if holder.is_none() {
            return ("", false);
        }
        let text = self.atoms().bytes(holder);
        let (text, is_static) = match text.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()) {
            Some(rest) => (rest, true),
            None => (text, matches!(text, b"Math" | b"JSON" | b"Reflect" | b"Atomics" | b"Console" | b"console")),
        };
        let text = ALIASES.iter().find(|alias| alias.0.as_bytes() == text).map_or(text, |alias| alias.1.as_bytes());
        if TYPED_ARRAYS.iter().any(|known| known.as_bytes() == text) {
            return ("TypedArray", is_static);
        }
        (holder_named(text).unwrap_or("?"), is_static)
    }

    /// What the built-in may do with its receiver and with each argument of the call: `uses`. The first entry whose patterns fit, as the
    /// engine has it. If none is seen to fit, all of them together, which holds whichever applies. `None`: the table has no entry.
    fn uses_by_built_in(&mut self, file: FileId, call: CallId, holder: Atom, name: Atom, is_constructed: bool) -> Option<(u16, Rc<[u16]>)> {
        if let Some(known) = self.aot.escape_closure.uses.get(&call) {
            return known.clone();
        }
        let found = self.uses_by_built_in_uncached(file, call, holder, name, is_constructed).map(|(this, of_arguments)| (this, Rc::from(of_arguments)));
        self.aot.escape_closure.uses.insert(call, found.clone());
        found
    }

    fn uses_by_built_in_uncached(&mut self, file: FileId, call: CallId, holder: Atom, name: Atom, is_constructed: bool) -> Option<(u16, Vec<u16>)> {
        let hir = self.hir(file);
        let (holder, is_static) = self.holder_in_table(holder);
        let name = self.atoms().bytes(name);
        let is_of_kind = |entry: &BuiltinEntry| match entry.kind {
            BuiltinKind::Function => holder.is_empty() && !is_constructed,
            BuiltinKind::Call => holder.is_empty() && !is_constructed,
            BuiltinKind::Construct => holder.is_empty() && is_constructed,
            BuiltinKind::Static => is_static,
            BuiltinKind::Method => !is_static && !holder.is_empty(),
            BuiltinKind::Getter | BuiltinKind::Setter | BuiltinKind::Intrinsic => false,
        };
        let entries: Vec<&'static BuiltinEntry> = entries_of(holder, name).iter().filter(|entry| entry.holder == holder && entry.name.as_bytes() == name && is_of_kind(entry)).collect();
        if entries.is_empty() {
            return None;
        }
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        let parameter_at = |entry: &BuiltinEntry, index: usize| entry.parameters.get(index).or_else(|| entry.parameters.last().filter(|last| last.1 == Arity::Rest)).copied();
        let has_spread = arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
        let types: Vec<TypeId> = arguments.iter().map(|&argument| self.type_of_expr(file, argument)).collect();
        let fitting = entries.iter().copied().find(|entry| {
            let required = entry.parameters.iter().filter(|parameter| parameter.1 == Arity::Required).count();
            !has_spread
                && arguments.len() >= required
                && (0..arguments.len()).all(|index| match parameter_at(entry, index) {
                    None => false,
                    Some((Pattern::Any, ..)) => true,
                    Some((Pattern::Number, ..)) => self.is_number_like(types[index]),
                    Some((Pattern::ToNumber | Pattern::ToString | Pattern::ToPropertyKey, ..)) => self.parts(types[index]).iter().all(|&part| self.has_primitive_flag(part)),
                    // Not seen to fit. That leads on to the entries behind it, which hold for any argument that this one holds for.
                    Some(_) => false,
                })
        });
        if let Some(entry) = fitting {
            return Some((entry.this, (0..arguments.len()).map(|index| parameter_at(entry, index).map_or(uses::EVERYTHING, |parameter| parameter.2)).collect()));
        }
        let this = entries.iter().fold(0, |all, entry| all | entry.this);
        let anywhere = entries.iter().flat_map(|entry| entry.parameters.iter()).fold(0, |all, parameter| all | parameter.2);
        let of_arguments = (0..arguments.len()).map(|index| if has_spread { anywhere } else { entries.iter().fold(0, |all, entry| all | parameter_at(entry, index).map_or(0, |parameter| parameter.2)) });
        Some((this, of_arguments.collect()))
    }

    /// `Object.assign`, `defineProperty` and the like, of which `note_what_is_done_by` sees which fields they write.
    fn is_field_writer(&self, holder: Atom, name: Atom) -> bool {
        let (holder, is_static) = self.holder_in_table(holder);
        is_static && matches!((holder, self.atoms().bytes(name)), ("Object", b"assign" | b"defineProperty" | b"defineProperties") | ("Reflect", b"defineProperty" | b"set" | b"deleteProperty"))
    }

    /// Whether the built-in is handed a function, as an argument or as its receiver, that takes what the types say nothing of: the replacer of
    /// `JSON.stringify`, `(function (this: any) { .. }).call(o)`. By the type of the function itself and by the type that `lib.*.d.ts` has for
    /// the parameter.
    fn has_callback_with_untyped_parameters(&mut self, file: FileId, call: CallId) -> bool {
        if let Some(&known) = self.aot.escape_closure.untyped_callbacks.get(&call) {
            return known;
        }
        let has = self.has_callback_with_untyped_parameters_uncached(file, call);
        self.aot.escape_closure.untyped_callbacks.insert(call, has);
        has
    }

    fn has_callback_with_untyped_parameters_uncached(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        let mut types: Vec<TypeId> = Vec::new();
        for argument in hir.ids(hir[call].args) {
            types.push(self.type_of_expr(file, argument));
            types.extend(self.declared_contextual_type(file, argument));
        }
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[hir[call].callee].kind {
            types.push(self.type_of_expr(file, obj));
        }
        types.into_iter().any(|ty| {
            let parts: Vec<TypeId> = self.parts(ty).to_vec();
            parts.into_iter().any(|part| {
                let signatures: Vec<SigId> = self.signatures(part, false).iter().copied().collect();
                signatures.into_iter().any(|signature| {
                    let parameters = self.sig_params(signature);
                    let this = self.sig_this_type(signature);
                    (0..parameters.len()).filter_map(|index| self.param_type_at(&parameters, index)).chain(this).collect::<Vec<TypeId>>().into_iter().any(|parameter| self.says_nothing_of_objects(parameter))
                })
            })
        })
    }

    /// An array, a tuple, a `Map`, a `Set`: what it holds is of the type it says, whoever reads it.
    fn is_container(&mut self, ty: TypeId) -> bool {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        parts.into_iter().all(|part| self.has_primitive_flag(part) || self.is_array_or_tuple(part) || self.element_of_array_subtype(part).is_some() || matches!(*self.data(part), TypeData::Ref { target, .. } if self.files.module(target.file).is_lib))
    }

    /// `e`: the receiver or an argument of a call of a built-in, which may do `used` with it.
    fn place_of_operand_of_built_in(&mut self, file: FileId, call_expr: ExprId, call: CallId, e: ExprId, used: u16, is_field_writer: bool) -> Entered {
        if used == uses::EVERYTHING {
            return Entered::Untyped;
        }
        let at = Place { file, pos: self.hir(file)[e].pos };
        if used & uses::WRITES_PROPERTIES != 0 && !is_field_writer {
            self.note_opened_field(file, e, Atom::NONE, at);
        }
        if used & uses::HANDS_OVER != 0 && self.has_callback_with_untyped_parameters(file, call) {
            return Entered::Untyped;
        }
        let own = self.type_of_expr(file, e);
        // The result is of the type that `lib.*.d.ts` has for it.
        let is_result_used = !matches!(self.bound(file).expr_parent[call_expr.idx()], Parent::Stmt(stmt) if matches!(self.hir(file)[stmt].kind, StmtKind::Expr(_)));
        if used & uses::RETURNS != 0 && is_result_used {
            let result = self.type_of_expr(file, call_expr);
            self.note_flow(own, result, at);
        }
        if used & uses::PARTS != 0 && !is_field_writer && !self.is_container(own) {
            self.note_parts_let_out(own, at);
        }
        // It is kept or called as the type that `lib.*.d.ts` has for the parameter. What is handed to a callback is handed over as the
        // parameters of that say.
        if used & (uses::KEEPS | uses::CALLS) != 0 && self.hir(file)[call].callee != e && !self.is_receiver_of(file, call, e) {
            return match self.declared_contextual_type(file, e) {
                Some(target) => Entered::Typed(target),
                None => Entered::Untyped,
            };
        }
        Entered::Nowhere
    }

    fn is_receiver_of(&self, file: FileId, call: CallId, e: ExprId) -> bool {
        let hir = self.hir(file);
        matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if obj == e)
    }

    /// `e`: the object of `access`, a property access. Where it goes if that is what a call calls.
    fn place_of_receiver(&mut self, file: FileId, e: ExprId, access: ExprId) -> Entered {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(call_expr) = bound.expr_parent[access.idx()] else { return Entered::Nowhere };
        let (ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) = hir[call_expr].kind else { return Entered::Nowhere };
        if hir[call].callee != access {
            return Entered::Nowhere;
        }
        // Handed over as `this`.
        let Some(signature) = self.resolved_signature(file, call_expr).sig else { return Entered::Untyped };
        match self.kind_of_callee(file, access, signature) {
            CalleeKind::Unknown => Entered::Untyped,
            // A method is typed code. What is in a field: C4.
            CalleeKind::Typed => Entered::Nowhere,
            CalleeKind::BuiltIn(holder, name) => {
                let used = self.uses_by_built_in(file, call, holder, name, false).map_or(uses::EVERYTHING, |found| found.0);
                self.place_of_operand_of_built_in(file, call_expr, call, e, used, false)
            }
        }
    }

    /// Whether what is stored to `target` can be got at by code that is not compiled with types: a property of the global object, an
    /// ambient variable, a property of an object that a declaration without a body or JavaScript stands for.
    fn is_place_of_untyped_code(&mut self, file: FileId, target: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[target].kind {
            ExprKind::Ident(_) => self.unvouched_claim(file, target).is_some(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                let is_global_object = matches!(hir[obj].kind, ExprKind::Ident(name) if matches!(self.atoms().bytes(name), b"globalThis" | b"window" | b"self" | b"global")
                    && self.resolve_identifier(file, obj, name, true).ok().flatten().is_none_or(|sym| self.hir(sym.file).kind == FileKind::Declaration));
                is_global_object || self.is_predicted(file, obj) || self.is_declared_by_javascript(file, target)
            }
            _ => false,
        }
    }

    /// Whether the property that `access` names is one that JavaScript declares.
    fn is_declared_by_javascript(&mut self, file: FileId, access: ExprId) -> bool {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[access].kind else { return false };
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts: Vec<TypeId> = self.parts(receiver).to_vec();
        parts.into_iter().any(|part| {
            let apparent = self.apparent_type(part);
            let declared_in = self.members(apparent).and_then(|members| match members.resolved.prop(name)?.source {
                crate::types::PropSource::Symbol(declared) => Some(declared.file),
                crate::types::PropSource::Literal(declared_in, _) => Some(declared_in),
                _ => None,
            });
            declared_in.is_some_and(|declared_in| self.is_untyped_file(declared_in))
        })
    }

    /// What a JavaScript file refers to that TypeScript declares gets to untyped code.
    fn note_escapes_to_javascript(&mut self, file: FileId) {
        self.note_alterations_by_javascript(file);
        self.aot.escape_closure.door = Door::ImportedByJavaScript;
        let hir = self.hir(file);
        let identifiers: Vec<ExprId> = self.exprs_by_kind_of(file).of(ExprTag::Ident).to_vec();
        let mut seen: FxHashSet<crate::program::Sym> = FxHashSet::default();
        for e in identifiers {
            let ExprKind::Ident(name) = hir[e].kind else { continue };
            let Some(sym) = self.resolve_identifier(file, e, name, true).ok().flatten() else { continue };
            if !self.files.flags(sym).contains(SymFlags::ALIAS) {
                continue;
            }
            let Some(target) = self.files.resolve_alias(sym) else { continue };
            if !seen.insert(target) {
                continue;
            }
            let is_typed = self.files.decls_of(target).iter().any(|&(declared_in, _)| !self.is_untyped_file(declared_in) && self.hir(declared_in).kind != FileKind::Declaration);
            if is_typed {
                let (of_target, at) = (self.type_of_symbol(target), Place { file, pos: hir[e].pos });
                self.note_let_through(of_target, true, at);
                // A namespace object: its exports.
                self.note_parts_let_out(of_target, at);
            }
        }
    }

    // ───────────────────────────── stores that are not seen as stores ─────────────────────────────

    fn views_of(&mut self, file: FileId, e: ExprId) -> LetThrough {
        let own = self.type_of_expr(file, e);
        let mut found = LetThrough::default();
        let parts: Vec<TypeId> = self.parts(own).to_vec();
        for part in parts {
            let part = self.reduced(part);
            if self.has_primitive_flag(part) || self.says_nothing(part) {
                continue;
            }
            if self.is_instantiable(part) {
                self.add_type_parameters_in(part, &mut found.leaks);
                let bound = self.base_constraint(part);
                if bound != part && self.says_properties(bound) {
                    let view = self.laid_out_as(bound);
                    found.escaped.push(view);
                }
            } else if self.says_properties(part) {
                let view = self.laid_out_as(part);
                found.escaped.push(view);
            }
        }
        found
    }

    /// A store to `name` of the object `obj`, or with `Atom::NONE` to any of its fields, that the closure over typed stores does not see.
    fn note_opened_field(&mut self, file: FileId, obj: ExprId, name: Atom, at: Place) {
        let found = self.views_of(file, obj);
        let noted = self.escapes_noted();
        for view in found.escaped {
            keep_least(&mut noted.opened_fields, (view, name), at);
        }
        // Written to as a type parameter: it is not known here what it is.
        for parameter in found.leaks {
            noted.add_seed(Node::Leaking(parameter), at, Door::Other);
        }
    }

    /// The name that the key is, if its type is one string.
    pub(super) fn name_of_key(&mut self, file: FileId, key: ExprId) -> Atom {
        let ty = self.type_of_expr(file, key);
        match *self.data(ty) {
            TypeData::StringLit { value, .. } => value,
            _ => Atom::NONE,
        }
    }

    fn note_store_to_target(&mut self, file: FileId, target: ExprId, is_seen_by_name: bool, at: Place) {
        let hir = self.hir(file);
        match hir[target].kind {
            ExprKind::Dot { obj, name, .. } if !is_seen_by_name => self.note_opened_field(file, obj, name, at),
            ExprKind::Index { obj, index, .. } => {
                let name = self.name_of_key(file, index);
                self.note_opened_field(file, obj, name, at);
            }
            ExprKind::Array(elements) => {
                for element in hir.ids(elements) {
                    self.note_store_to_target(file, element, false, at);
                }
            }
            ExprKind::Object(props) => {
                for prop in props.iter() {
                    if hir[prop].value.is_some() {
                        self.note_store_to_target(file, hir[prop].value, false, at);
                    }
                }
            }
            ExprKind::Spread(inner) | ExprKind::NonNull(inner) | ExprKind::As { expr: inner, .. } | ExprKind::Satisfies { expr: inner, .. } => self.note_store_to_target(file, inner, is_seen_by_name, at),
            ExprKind::Assign { target: inner, .. } => self.note_store_to_target(file, inner, false, at),
            _ => {}
        }
    }

    /// What the expression does besides yielding a value.
    fn note_what_is_done_by(&mut self, file: FileId, e: ExprId, at: Place) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[e].kind {
            ExprKind::Assign { target, .. } => self.note_store_to_target(file, target, true, at),
            ExprKind::Unary { op: UnOp::Delete, operand } => self.note_store_to_target(file, operand, false, at),
            // A direct `eval` sees the variables around it. Any other code that is made from text sees the globals and what it is handed.
            ExprKind::Ident(name)
                if self.atoms().bytes(name) == b"eval"
                    && matches!(bound.expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Call(call) if hir[call].callee == e))
                    && self.resolve_identifier(file, e, name, true).ok().flatten().is_none_or(|sym| self.files.module(sym.file).is_lib) =>
            {
                let noted = self.escapes_noted();
                noted.everything = Some(noted.everything.map_or(at, |first| first.min(at)));
            }
            ExprKind::Ident(_) if bound.is_arguments_object(e) => {
                if let Some(func) = self.enclosing_fn_of_expr(file, e) {
                    for parameter in hir[func].params.iter() {
                        let of_parameter = self.type_of_param(file, parameter);
                        self.note_let_through(of_parameter, true, at);
                    }
                }
            }
            ExprKind::Object(props) => {
                for prop in props.iter().filter(|&prop| hir[prop].kind == PropKind::Spread) {
                    let (source, made) = (self.views_of(file, hir[prop].value), self.views_of(file, e));
                    self.note_fields_copied(source, made, at);
                }
            }
            ExprKind::Call(call) => {
                let callee = hir[call].callee;
                let ExprKind::Dot { obj, name, .. } = hir[callee].kind else { return };
                let ExprKind::Ident(global) = hir[obj].kind else { return };
                let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                let Some(&target) = arguments.first() else { return };
                let atoms = self.atoms();
                match (atoms.bytes(global), atoms.bytes(name)) {
                    (b"Object", b"assign") => {
                        for &source in &arguments[1..] {
                            let (source, made) = (self.views_of(file, source), self.views_of(file, target));
                            self.note_fields_copied(source, made, at);
                        }
                    }
                    (b"Object" | b"Reflect", b"defineProperty") | (b"Reflect", b"set" | b"deleteProperty") => {
                        let name = arguments.get(1).map_or(Atom::NONE, |&key| self.name_of_key(file, key));
                        self.note_opened_field(file, target, name, at);
                    }
                    (b"Object", b"defineProperties") => self.note_opened_field(file, target, Atom::NONE, at),
                    _ => {}
                }
            }
            _ => {}
        }
        // `for (o.f of list)`
        if let Parent::Stmt(stmt) = bound.expr_parent[e.idx()]
            && let StmtKind::Expr(_) = hir[stmt].kind
            && let Parent::Stmt(outer) = bound.stmt_parent[stmt.idx()]
            && let StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } = hir[outer].kind
            && left == stmt
        {
            self.note_store_to_target(file, e, false, at);
        }
    }

    fn note_fields_copied(&mut self, source: LetThrough, made: LetThrough, at: Place) {
        let noted = self.escapes_noted();
        for &target in &made.escaped {
            // A source of which it is not known what it is.
            if source.escaped.is_empty() || !source.leaks.is_empty() {
                keep_least(&mut noted.opened_fields, (target, Atom::NONE), at);
            }
            for &from in &source.escaped {
                noted.copies_fields.insert((from, target));
            }
        }
        for parameter in made.leaks {
            noted.add_seed(Node::Leaking(parameter), at, Door::Other);
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    fn describe_escape(&mut self, cause: EscapeCause, views: &[TypeId]) -> String {
        match cause {
            EscapeCause::Seed(at, _) => {
                let text = &self.hir(at.file).text;
                let from = (at.pos as usize).min(text.len());
                let line: Vec<u8> = text[from..].iter().copied().take_while(|&byte| byte != b'\n').take(48).collect();
                format!("a value goes to untyped code at {}: {}", self.place_for_people(at), String::from_utf8_lossy(&line))
            }
            EscapeCause::MemberOfAdmitting(view) => format!("{} admits untyped objects", self.name_for_people(views[view as usize])),
            EscapeCause::ReceiverOfUnknown(at) => format!("what is stored to a field for a function at {} is not seen through", self.place_for_people(at)),
            EscapeCause::Everything(at) => format!("a direct eval at {}", self.place_for_people(at)),
        }
    }

    /// `--aot-explain=escapes`. The first two lines and those that begin with `escapes: by door:` are numbers alone.
    pub fn explain_escapes(&mut self, views: &[TypeId], membership: &Membership) -> Vec<String> {
        let allocated: Vec<usize> = (0..views.len()).filter(|&view| membership.views[view].is_allocated).collect();
        let mut by_cause: FxHashMap<EscapeCause, u32> = FxHashMap::default();
        for &view in &allocated {
            if let Some(cause) = membership.escaped[view] {
                *by_cause.entry(cause).or_default() += 1;
            }
        }
        let mut causes: Vec<(EscapeCause, u32)> = by_cause.into_iter().collect();
        causes.sort_unstable_by_key(|&(cause, layouts)| (std::cmp::Reverse(layouts), cause.rank()));
        let mut facts = 0;
        let mut doubts: FxHashMap<Doubt, u32> = FxHashMap::default();
        for callee in allocated.iter().flat_map(|&view| &membership.views[view].callees) {
            match callee.3 {
                Certainty::Fact => facts += 1,
                Certainty::Predicted(doubt) => *doubts.entry(doubt).or_default() += 1,
            }
        }
        let mut doubts: Vec<(Doubt, u32)> = doubts.into_iter().collect();
        doubts.sort_unstable();
        let mut lines = vec![
            format!("escapes: {} of {} allocated layouts have escaped, for {} causes", causes.iter().map(|cause| cause.1).sum::<u32>(), allocated.len(), causes.len()),
            format!("escapes: of the fields of allocated layouts that hold one function as far as is seen, {facts} do for a fact; the others: {doubts:?}"),
        ];
        for of in &membership.escapes_by_door {
            lines.push(format!("escapes: by door: {:?}: {} seeds; {} allocated layouts escape through it alone; {} with it shut and the others open", of.door, of.seeds, of.alone, of.without));
        }
        for &(cause, layouts) in causes.iter().take(40) {
            let why = self.describe_escape(cause, views);
            lines.push(format!("escapes: {layouts} layouts: {why}"));
        }
        for &view in &allocated {
            let name = self.name_for_people(views[view]);
            match membership.escaped[view] {
                None => lines.push(format!("escapes: not escaped: {name}")),
                Some(cause) => {
                    let why = self.describe_escape(cause, views);
                    lines.push(format!("escapes: escaped: {name}: {why}"));
                }
            }
            // By name: the number of an atom is not the same from run to run.
            let mut of_fields: Vec<String> = Vec::new();
            for &(field, file, func, certainty) in &membership.views[view].callees {
                let at = self.line_for_people(file, self.hir(file)[func].start);
                let field = String::from_utf8_lossy(self.atoms().bytes(field)).into_owned();
                match certainty {
                    Certainty::Fact => of_fields.push(format!("escapes: fact: {name}.{field} holds the function at {at}")),
                    Certainty::Predicted(Doubt::Escaped) => {}
                    Certainty::Predicted(doubt) => of_fields.push(format!("escapes: no fact: {name}.{field}: {doubt:?}")),
                }
            }
            of_fields.sort_unstable();
            lines.append(&mut of_fields);
        }
        lines
    }
}

// ───────────────────────────── the closure ─────────────────────────────

/// Why a layout has escaped.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum EscapeCause {
    /// A value of a type goes to untyped code there.
    Seed(Place, Door),
    /// A view that admits untyped objects has a member of the type: the number of the view.
    MemberOfAdmitting(u32),
    /// It has a field for a function that something is stored to there which is not seen through, and is handed to that as `this`.
    ReceiverOfUnknown(Place),
    Everything(Place),
}

impl EscapeCause {
    fn door(self) -> Door {
        match self {
            EscapeCause::Seed(_, door) => door,
            EscapeCause::MemberOfAdmitting(_) => Door::ViewAdmitsUntyped,
            EscapeCause::ReceiverOfUnknown(_) => Door::FieldHoldsUnknownFunction,
            EscapeCause::Everything(_) => Door::DirectEval,
        }
    }

    /// For an order that does not depend on how the causes were come by.
    fn rank(self) -> (u8, Place, u32) {
        match self {
            EscapeCause::Everything(at) => (0, at, 0),
            EscapeCause::Seed(at, door) => (1, at, door as u32),
            EscapeCause::MemberOfAdmitting(view) => (2, Place::default(), view),
            EscapeCause::ReceiverOfUnknown(at) => (3, at, 0),
        }
    }
}

pub(super) struct EscapeClosure {
    /// By view: why it has escaped.
    pub escaped: Vec<Option<EscapeCause>>,
    /// By layout: untyped code puts an object where one of it is expected, so that plain data may be copied into one.
    pub is_copied_into: Vec<bool>,
    /// By layout: a store to any field is not seen.
    pub is_open: Vec<bool>,
    pub open_fields: FxHashSet<(u32, Atom)>,
    /// If it is asked for.
    pub by_door: Vec<ByDoor>,
}

/// How many seeds come through a door, how many allocated layouts escape through it alone, and how many with it shut and all others open.
#[derive(Copy, Clone, Debug)]
pub struct ByDoor {
    pub door: Door,
    pub seeds: u32,
    pub alone: u32,
    pub without: u32,
}

pub(super) struct ClosureInput<'a> {
    pub views: usize,
    pub index_of: &'a FxHashMap<TypeId, u32>,
    /// By view: the layouts whose objects can be in a place of it. What is not below `views` is not laid out.
    pub sets: &'a [Vec<u32>],
    pub admits_untyped: &'a [bool],
    pub is_allocated: &'a [bool],
    /// By view: the views in the types of its fields.
    pub held_by_fields: &'a dyn Fn(u32) -> Vec<u32>,
    pub types: &'a ForClosure,
    /// The layouts with a field for a function that something is stored to which is not seen through, each with the first place.
    pub unknown_callees: &'a [(u32, Place)],
}

impl EscapeClosure {
    pub(super) fn close(noted: &Escapes<TypeId>, input: &ClosureInput) -> EscapeClosure {
        let views = input.views;
        // `Escaped` of the views, `CopiedInto` of the views, and then the others as they come.
        let mut number_of: FxHashMap<Node, u32> = FxHashMap::default();
        let mut nodes = 2 * views as u32;
        let mut number = |node: Node| -> u32 {
            match node {
                Node::Escaped(ty) if input.index_of.contains_key(&ty) => input.index_of[&ty],
                Node::CopiedInto(ty) if input.index_of.contains_key(&ty) => views as u32 + input.index_of[&ty],
                _ => *number_of.entry(node).or_insert_with(|| {
                    nodes += 1;
                    nodes - 1
                }),
            }
        };
        let (mut edges, mut begun): (Vec<(u32, u32)>, Vec<(EscapeCause, u32)>) = (Vec::with_capacity(noted.edges.len() + input.types.noted.edges.len()), Vec::new());
        for noted in [noted, &input.types.noted] {
            let numbers: Vec<u32> = noted.nodes.iter().map(|&node| number(node)).collect();
            edges.extend(noted.edges.iter().map(|&(from, to)| (numbers[from as usize], numbers[to as usize])));
            begun.extend(noted.seeds.iter().map(|&(node, at, door)| (EscapeCause::Seed(at, door), numbers[node as usize])));
        }
        // The views that admit untyped objects, as far as anything comes of that.
        let mut admitting: Vec<(u32, u32)> = Vec::new();
        for noted in [noted, &input.types.noted] {
            for &node in &noted.nodes {
                if let Node::AdmitsUntyped(ty) = node
                    && let Some(&view) = input.index_of.get(&ty)
                    && input.admits_untyped[view as usize]
                {
                    admitting.push((view, number(node)));
                }
            }
        }
        admitting.sort_unstable();
        admitting.dedup();
        begun.extend(admitting.into_iter().map(|(view, node)| (EscapeCause::MemberOfAdmitting(view), node)));
        let members_out: Vec<Option<u32>> = input.types.members_out.iter().map(|node| node.map(&mut number)).collect();
        let members_in: Vec<Option<u32>> = input.types.members_in.iter().map(|node| node.map(&mut number)).collect();
        let nodes = nodes as usize;
        edges.sort_unstable();
        edges.dedup();
        // By node: where its successors begin among `edges`.
        let mut begins = vec![0u32; nodes + 1];
        for &(from, _) in &edges {
            begins[from as usize + 1] += 1;
        }
        for node in 0..nodes {
            begins[node + 1] += begins[node];
        }

        // One worklist, the seeds in the order of their causes, each closed before the next is begun: the cause of a node is the least that
        // gets to it, in whatever order the rest is gone through.
        if let Some(at) = noted.everything {
            begun.extend((0..nodes as u32).map(|node| (EscapeCause::Everything(at), node)));
        }
        // C2
        for view in (0..views).filter(|&view| input.admits_untyped[view]) {
            let cause = EscapeCause::MemberOfAdmitting(view as u32);
            begun.extend((input.held_by_fields)(view as u32).into_iter().map(|held| (cause, held)));
            begun.extend(members_out[view].into_iter().chain(members_in[view]).map(|node| (cause, node)));
        }
        // C4
        begun.extend(input.unknown_callees.iter().map(|&(layout, at)| (EscapeCause::ReceiverOfUnknown(at), layout)));
        begun.sort_by_key(|seed| std::cmp::Reverse(seed.0.rank()));
        let close = |begun: Vec<(EscapeCause, u32)>| -> Vec<Option<EscapeCause>> {
            let mut holds: Vec<Option<EscapeCause>> = vec![None; nodes];
            let mut pending = begun;
            while let Some((cause, node)) = pending.pop() {
                let at = node as usize;
                if holds[at].is_some() {
                    continue;
                }
                holds[at] = Some(cause);
                pending.extend(edges[begins[at] as usize..begins[at + 1] as usize].iter().map(|edge| (cause, edge.1)));
                if at < views {
                    // C1. Whoever has it writes its members as well.
                    pending.extend(input.sets[at].iter().filter(|&&layout| (layout as usize) < views).map(|&layout| (cause, layout)));
                    pending.extend((input.held_by_fields)(node).into_iter().map(|held| (cause, held)));
                    pending.push((cause, (views + at) as u32));
                    pending.extend(members_out[at].map(|members| (cause, members)));
                } else if at < 2 * views {
                    let view = at - views;
                    pending.extend(input.sets[view].iter().filter(|&&layout| (layout as usize) < views).map(|&layout| (cause, views as u32 + layout)));
                    pending.extend(members_in[view].map(|members| (cause, members)));
                }
            }
            holds
        };
        // What each door lets out by itself, and what is let out with that door shut.
        let mut by_door: Vec<ByDoor> = Vec::new();
        if input.types.is_explained {
            let mut doors: Vec<Door> = begun.iter().map(|seed| seed.0.door()).collect();
            doors.sort_unstable();
            doors.dedup();
            let escaped = |begun: Vec<(EscapeCause, u32)>| close(begun)[..views].iter().zip(input.is_allocated).filter(|(cause, is_allocated)| cause.is_some() && **is_allocated).count() as u32;
            for door in doors {
                let of_door = |is_of_door: bool| begun.iter().copied().filter(|seed| (seed.0.door() == door) == is_of_door).collect::<Vec<_>>();
                by_door.push(ByDoor { door, seeds: of_door(true).len() as u32, alone: escaped(of_door(true)), without: escaped(of_door(false)) });
            }
        }
        let mut holds = close(begun);
        let is_copied_into: Vec<bool> = holds[views..2 * views].iter().map(Option::is_some).collect();
        holds.truncate(views);
        let escaped = holds;

        let mut is_open = vec![false; views];
        let mut open_fields: FxHashSet<(u32, Atom)> = FxHashSet::default();
        for &(ty, name) in noted.opened_fields.keys() {
            let Some(&view) = input.index_of.get(&ty) else { continue };
            for &layout in input.sets[view as usize].iter().filter(|&&layout| (layout as usize) < views) {
                if name.is_none() {
                    is_open[layout as usize] = true;
                } else {
                    open_fields.insert((layout, name));
                }
            }
        }
        EscapeClosure { escaped, is_copied_into, is_open, open_fields, by_door }
    }

    /// `copies_fields`, as pairs of views.
    pub(super) fn copies(noted: &Escapes<TypeId>, index_of: &FxHashMap<TypeId, u32>) -> Vec<(Option<u32>, u32)> {
        let mut copies: Vec<(Option<u32>, u32)> = noted.copies_fields.iter().filter_map(|(from, to)| Some((index_of.get(from).copied(), *index_of.get(to)?))).collect();
        copies.sort_unstable();
        copies
    }
}

/// How sure it is that a field holds the function.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Certainty {
    /// A store may not have been seen.
    Predicted(Doubt),
    /// Every store is seen: it holds a closure of the function, or nothing has been stored to it.
    Fact,
}

/// Why it is not known that a field holds the function that it is seen to hold. The first that applies, in this order.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Doubt {
    /// The view admits untyped objects.
    AdmitsUntyped,
    /// A layout of the view has escaped.
    Escaped,
    /// A store by a computed key, a built-in, `delete` or a pattern to an object of a layout of the view.
    OpenedField,
    /// `Object.assign` or a spread from a source of which it is not known what it is.
    CopiedBlindly,
    /// Untyped code puts an object where one of the layout is expected: plain data is copied into one.
    Retagged,
    /// `Object.assign` or a spread brings another function.
    CopiedFromAnother,
    /// The field may be absent, and then what the prototype chain has by the name is read. The link finds that out.
    MayBeInherited,
}

/// Where the value is that is not seen through, if the functions that get to the place are not all known.
pub(super) fn place_not_seen_through(callee: Callee) -> Option<Place> {
    match callee {
        Callee::Unknown(at) => Some(at),
        Callee::Nothing | Callee::One(..) | Callee::Several(..) => None,
    }
}

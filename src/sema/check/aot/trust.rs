//! Which declarations the compiler trusts.
//!
//! The line is whether the checker has seen the code behind a claim.
//! 1. Ordinary TypeScript (a body, a literal, a `new`) is checked against its annotation: a fact.
//! 2. An escape hatch (`as`, `!`, a type guard, a value out of `any`) is asserted or coerced on the spot.
//! 3. A declaration WITHOUT A BODY is a prediction: a `.d.ts`, `declare function`, `declare const`, `declare class`, `declare global`,
//!    `declare module`, an overload list without an implementation, a file in whose place other code runs
//!    (`Checker::only_declares`). The static type of what it produces is `unknown`, the declared
//!    type is the predicted type. Guarded fast path, generic fallback, never a `TypeError`.
//!
//! The predicate is on the declaration that PRODUCED the value, not on its type: `const o: FromADts = { .. }` is the program's own claim.
//!
//! What the engine implements itself stays trusted: `BUILTINS`. So do the libraries that the toolchain vouches for: `libraries.rs`.

use crate::atom::{Atom, SYMBOL_NAME_PREFIX};
use crate::bind::{Decl, MemberOwner, SymFlags};
use crate::check::Checker;
use super::builtins_generated::BUILTINS;
use super::flows::Place;
use super::storage::Query;
use crate::hir::{ExprId, ExprKind, FnBody, MemberKind};
use crate::program::{FileId, Sym};
use crate::types::{Prop, PropSource, TypeData, TypeId};
use crate::util::FxHashMap;

/// Globals of the language that are no functions.
const GLOBAL_VALUES: &[&str] = &["undefined", "NaN", "Infinity", "globalThis"];

/// Interfaces of `lib.*.d.ts` that describe objects of a holder under another name.
pub(super) const ALIASES: &[(&str, &str)] = &[
    ("ReadonlyArray", "Array"),
    ("ConcatArray", "Array"),
    ("TemplateStringsArray", "Array"),
    ("RegExpMatchArray", "Array"),
    ("RegExpExecArray", "Array"),
    ("ReadonlyMap", "Map"),
    ("ReadonlySet", "Set"),
    ("ReadonlySetLike", "Set"),
    ("CallableFunction", "Function"),
    ("NewableFunction", "Function"),
    ("PromiseLike", "Promise"),
    ("Console", "console"),
    ("IteratorObject", "Iterator"),
    ("IterableIterator", "Iterator"),
    ("ArrayIterator", "Iterator"),
    ("MapIterator", "Iterator"),
    ("SetIterator", "Iterator"),
    ("StringIterator", "Iterator"),
    ("RegExpStringIterator", "Iterator"),
    ("Generator", "Iterator"),
    ("Iterator", "Iterator"),
];

pub(super) const TYPED_ARRAYS: &[&str] = &[
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
];

fn names_of(holder: &[u8]) -> Option<&'static str> {
    BUILTINS.iter().find(|entry| entry.0.as_bytes() == holder).map(|entry| entry.1)
}

fn has_entry(holder: &[u8], name: &[u8]) -> bool {
    names_of(holder).is_some_and(|names| names.split(' ').any(|known| known.as_bytes() == name))
}

/// What a declaration without a body claimed.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Claim {
    /// The value of an ambient variable, function, class, namespace or module.
    Binding,
    /// The result of calling a value that is itself predicted.
    Call,
    /// The same, where the declared result mentions a type parameter, so that its type is what the call puts in for that: inferred
    /// from the arguments of the program, `lib.first(rows)`.
    GenericCall,
    /// The same, where the program writes the type arguments: `lib.parse<Row[]>(text)`.
    GenericCallWithTypeArguments,
    New,
    /// A property or an element of a value that is itself predicted, or a property of an engine object that the table has no entry for.
    Property,
    Await,
}

impl Claim {
    const ALL: [Claim; 7] = [Claim::Binding, Claim::Call, Claim::GenericCall, Claim::GenericCallWithTypeArguments, Claim::New, Claim::Property, Claim::Await];

    /// For `Checker::solve`.
    fn encode(claim: Option<Claim>) -> u64 {
        claim.map_or(0, |claim| Claim::ALL.iter().position(|&it| it == claim).map_or(0, |at| at as u64 + 1))
    }

    fn decode(encoded: u64) -> Option<Claim> {
        encoded.checked_sub(1).and_then(|at| Claim::ALL.get(at as usize).copied())
    }

    pub fn text(self) -> &'static str {
        match self {
            Claim::Binding => "binding",
            Claim::Call => "call",
            Claim::GenericCall => "generic call",
            Claim::GenericCallWithTypeArguments => "generic call with type arguments",
            Claim::New => "new",
            Claim::Property => "property",
            Claim::Await => "await",
        }
    }
}

#[derive(Default)]
pub(super) struct State {
    claims: FxHashMap<(FileId, ExprId), Option<Claim>>,
    ambient: FxHashMap<Sym, bool>,
}

impl<'p, 's> Checker<'p, 's> {
    /// If the checker's type of `e` rests on a declaration without a body that the engine does not implement: what was claimed. The
    /// value is then `unknown` with the checker's type as its prediction.
    pub fn unvouched_claim(&mut self, file: FileId, e: ExprId) -> Option<Claim> {
        if !matches!(
            self.hir(file)[e].kind,
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::TaggedTemplate(_) | ExprKind::New(_) | ExprKind::Await(_)
        ) {
            return None;
        }
        if let Some(&known) = self.aot.trust.claims.get(&(file, e)) {
            return known;
        }
        // Whether a value is predicted may depend on itself. Then it is: the safe side.
        if let Some(assumed) = self.assumption(Query::Claim(file, e)) {
            return Claim::decode(assumed);
        }
        let predicted = Claim::encode(Some(match self.hir(file)[e].kind {
            ExprKind::Ident(_) => Claim::Binding,
            ExprKind::New(_) => Claim::New,
            ExprKind::Await(_) => Claim::Await,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => Claim::Property,
            _ => Claim::Call,
        }));
        let (found, is_final) = self.solve(Query::Claim(file, e), predicted, predicted, |c| Claim::encode(c.find_unvouched_claim(file, e)));
        let found = Claim::decode(found);
        if is_final {
            self.aot.trust.claims.insert((file, e), found);
        }
        found
    }

    /// Whether `e` yields `unknown` although the checker has a type for it: a prediction, or what has been computed or read from one.
    pub fn is_predicted(&mut self, file: FileId, e: ExprId) -> bool {
        let yielded = self.type_yielded_by(file, e);
        self.says_nothing(yielded) && {
            let checked = self.type_of_expr(file, e);
            !self.says_nothing(checked)
        }
    }

    fn find_unvouched_claim(&mut self, file: FileId, e: ExprId) -> Option<Claim> {
        let hir = self.hir(file);
        // An export of a library that the toolchain vouches for is trusted like a built-in.
        if self.vouched_export(file, e).is_some() {
            return None;
        }
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let sym = if self.files.flags(sym).contains(SymFlags::ALIAS) { self.files.resolve_alias(sym)? } else { sym };
                (self.is_ambient_value(sym) && !self.is_builtin_global(sym)).then_some(Claim::Binding)
            }
            ExprKind::Dot { obj, name, .. } => {
                if matches!(hir[obj].kind, ExprKind::Super) {
                    return None;
                }
                let receiver = self.type_of_expr(file, obj);
                (self.is_predicted(file, obj) || self.is_unlisted_property(file, obj, name) || self.has_predicted_prop(receiver, name) || self.has_member_of_class_without_body(receiver, name))
                    .then_some(Claim::Property)
            }
            ExprKind::Index { obj, .. } => self.is_predicted(file, obj).then_some(Claim::Property),
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                let callee = hir[call].callee;
                if self.is_made_through_constructor_of_heir(file, e, callee) {
                    return Some(Claim::Call);
                }
                // The type of the call is that of its first argument, and more.
                if self.redefines_literal(file, e) || self.argument_handed_back_by(file, e).is_some_and(|first| self.is_predicted(file, first)) {
                    return Some(Claim::Call);
                }
                if matches!(hir[callee].kind, ExprKind::Super) || !self.is_predicted(file, callee) {
                    return None;
                }
                let is_generic = match self.resolved_signature(file, e).sig {
                    Some(sig) => self.sig_decl(sig).is_some_and(|(of, func, _)| self.return_type_of_fn(of, func) != self.sig_return(sig)),
                    None => false,
                };
                Some(match (is_generic, hir[call].type_args.is_empty()) {
                    (false, _) => Claim::Call,
                    (true, true) => Claim::GenericCall,
                    (true, false) => Claim::GenericCallWithTypeArguments,
                })
            }
            ExprKind::New(call) => self.is_predicted(file, hir[call].callee).then_some(Claim::New),
            ExprKind::Await(operand) => self.is_predicted(file, operand).then_some(Claim::Await),
            _ => None,
        }
    }

    /// `mine.map(f)`, `Mine.from(list)`, where `class Mine extends Array<number>`: `lib.*.d.ts` says that the call yields a `number[]`. The
    /// engine makes what it yields through the constructor of the receiver (`Symbol.species`, `this`): a `Mine`. So of a method that
    /// `lib.*.d.ts` declares, called on an object or on the constructor of a class that extends a class of the engine, what is declared
    /// to be an object is a prediction.
    fn is_made_through_constructor_of_heir(&mut self, file: FileId, e: ExprId, callee: ExprId) -> bool {
        let ExprKind::Dot { obj, .. } = self.hir(file)[callee].kind else { return false };
        let is_declared_by_lib = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)).is_some_and(|(of, ..)| self.files.module(of).is_lib);
        if !is_declared_by_lib || matches!(self.hir(file)[obj].kind, ExprKind::Super) {
            return false;
        }
        let yielded = self.type_of_expr(file, e);
        if !self.parts(yielded).to_vec().into_iter().any(|part| self.is_object_type(part)) {
            return false;
        }
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        self.parts(receiver).to_vec().into_iter().any(|part| {
            let Some((of, class)) = self.class_of_type(part, false).or_else(|| self.class_of_type(part, true)) else { return false };
            let instances = self.type_of_instances(of, class);
            self.is_array_like(instances) || self.built_in_extended_by(instances).is_some()
        })
    }

    /// Whether no declaration of the symbol that gives it a value has code behind it: all are in a declaration file or under `declare`, and
    /// no function among them has a body. An enum is its constants, wherever it is declared.
    fn is_ambient_value(&mut self, sym: Sym) -> bool {
        if let Some(&known) = self.aot.trust.ambient.get(&sym) {
            return known;
        }
        let mut has_value = false;
        let mut is_ambient = true;
        for (file, decl) in self.files.decls(sym) {
            let hir = self.hir(file);
            let has_code = match decl {
                Decl::Fn(f) => !matches!(hir[f].body, FnBody::None),
                Decl::Var(_) | Decl::Class(_) | Decl::Module(_) => !hir.is_ambient(hir.node(decl)),
                Decl::File => true,
                Decl::Interface(_) | Decl::Alias(_) | Decl::TypeParam(_) => continue,
                _ => true,
            };
            has_value = true;
            is_ambient &= !has_code || self.only_declares(file);
        }
        let found = has_value && is_ambient;
        self.aot.trust.ambient.insert(sym, found);
        found
    }

    /// `Math`, `JSON`, `Map`, `parseInt`, `console`, `undefined`: an ambient global that the table knows as a holder, a function or a
    /// constructor, whichever declaration file declares it.
    fn is_builtin_global(&self, sym: Sym) -> bool {
        // A module has no name.
        let name = self.files.symbol(sym).name;
        if name.is_none() || self.files.parent_of_symbol(sym).is_some() {
            return false;
        }
        let name = self.atoms().bytes(name);
        has_entry(b"", name) || names_of(name).is_some() || GLOBAL_VALUES.iter().chain(TYPED_ARRAYS).any(|known| known.as_bytes() == name)
    }

    /// Whether `obj.name` reads a property that `lib.*.d.ts` declares for an object of the engine and the table has no entry for:
    /// `error.message`, `match.index`, `fn.name`. What the program itself declares for such an object, `NodeArray.pos`, is its own claim.
    fn is_unlisted_property(&mut self, file: FileId, obj: ExprId, name: Atom) -> bool {
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts: Vec<TypeId> = self.parts(receiver).to_vec();
        parts.into_iter().any(|part| {
            let apparent = self.apparent_type(part);
            let Some(members) = self.members(apparent) else { return false };
            let Some(prop) = members.resolved.prop(name) else { return false };
            let PropSource::Symbol(declared) = prop.source else { return false };
            self.files.module(declared.file).is_lib && self.holder_of(declared).is_some_and(|holder| !self.is_listed(holder, name))
        })
    }

    /// Whether the engine itself vouches for the type of `e`: it reads a property or calls a method that `lib.*.d.ts` declares for an object of
    /// the engine, the table has an entry for it, and what is declared for it mentions no type parameter. `a.length`, `map.has(k)`,
    /// `text.startsWith(p)`, `Array.isArray(x)`. Not `map.get(k)` or `a.find(f)`: what a container holds, its history says.
    pub fn is_vouched_by_engine(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let (obj, name) = match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => (obj, name),
            ExprKind::Call(call) => {
                let ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return false };
                let Some(sig) = self.resolved_signature(file, e).sig else { return false };
                let Some((of, func, _)) = self.sig_decl(sig) else { return false };
                if !self.files.module(of).is_lib || self.return_type_of_fn(of, func) != self.sig_return(sig) {
                    return false;
                }
                (obj, name)
            }
            _ => return false,
        };
        let receiver = self.type_of_expr(file, obj);
        let receiver = self.non_nullable(receiver);
        let parts: Vec<TypeId> = self.parts(receiver).to_vec();
        !parts.is_empty()
            && parts.into_iter().all(|part| {
                let apparent = self.apparent_type(part);
                let Some(members) = self.members(apparent) else { return false };
                let Some(prop) = members.resolved.prop(name) else { return false };
                let PropSource::Symbol(declared) = prop.source else { return false };
                self.files.module(declared.file).is_lib && self.holder_of(declared).is_some_and(|holder| self.is_holder_of_the_engine(holder) && self.is_listed(holder, name))
            })
    }

    /// Whether the table knows the holder, as `lib.*.d.ts` names it: see `is_listed`.
    fn is_holder_of_the_engine(&self, holder: Atom) -> bool {
        let holder = self.atoms().bytes(holder);
        let holder = holder.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()).unwrap_or(holder);
        let holder = ALIASES.iter().find(|alias| alias.0.as_bytes() == holder).map_or(holder, |alias| alias.1.as_bytes());
        names_of(holder).is_some() || TYPED_ARRAYS.iter().any(|known| known.as_bytes() == holder)
    }

    /// Whether the property is one of an object literal that nothing is written down for, initialized with a prediction: `return {
    /// performance }`. It is like an unannotated variable: its type was inferred from the declaration without a body, so what it holds
    /// stays a prediction, and the field has room for anything.
    pub fn is_prop_predicted(&mut self, prop: &Prop) -> bool {
        let PropSource::Literal(file, declared) = prop.source else { return false };
        let value = self.hir(file)[declared].value;
        value.is_some() && self.is_predicted(file, value)
    }

    /// Whether some object of the type has such a property by the name.
    pub(super) fn has_predicted_prop(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.non_nullable(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        parts.into_iter().any(|part| {
            let Some(members) = self.members(part) else { return false };
            members.resolved.prop(name).is_some_and(|prop| self.is_prop_predicted(prop))
        })
    }

    /// Whether some object of the type has the property from a class without a body: `this.props` and `this.state` where `class App extends
    /// Component<Props, State>` of `@types/react`. The code behind that class stores to it, and nobody has held that code to what is declared.
    fn has_member_of_class_without_body(&mut self, ty: TypeId, name: Atom) -> bool {
        let ty = self.non_nullable(ty);
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        parts.into_iter().any(|part| {
            // `this` is of a type parameter.
            let apparent = self.apparent_type(part);
            self.is_declared_by_class_without_body(apparent, name, 0)
        })
    }

    fn is_declared_by_class_without_body(&mut self, class: TypeId, name: Atom, depth: u32) -> bool {
        let Some(members) = self.members(class) else { return false };
        let Some(prop) = members.resolved.prop(name) else { return false };
        let PropSource::Symbol(declared) = prop.source else { return false };
        if self.files.module(declared.file).is_lib {
            return false;
        }
        let member_of_class = |c: &Self, file: FileId, decl: Decl| match decl {
            Decl::Member(member) if matches!(c.bound(file).member_owner[member.idx()], MemberOwner::Class(_)) => Some(c.hir(file)[member].kind),
            _ => None,
        };
        let decls = self.files.decls(declared);
        if decls.iter().all(|&(file, decl)| member_of_class(self, file, decl).is_some() && (self.only_declares(file) || self.hir(file).is_ambient(self.hir(file).node(decl)))) {
            return true;
        }
        // A field that the program declares again, `state = { seen: 0 }`: the code behind the class that it extends stores to it all the same.
        let TypeData::Ref { target, .. } = *self.data(class) else { return false };
        depth < 16
            && decls.iter().all(|&(file, decl)| member_of_class(self, file, decl) == Some(MemberKind::Property))
            && self.base_types(target).into_vec().into_iter().any(|base| self.is_declared_by_class_without_body(base, name, depth + 1))
    }

    /// The name of the interface, class or namespace that declares the member.
    pub(super) fn holder_of(&self, member: Sym) -> Option<Atom> {
        if let Some(parent) = self.files.parent_of_symbol(member) {
            return Some(self.files.symbol(parent).name);
        }
        self.files.decls(member).into_iter().find_map(|(file, decl)| match decl {
            Decl::Member(m) => match self.bound(file).member_owner[m.idx()] {
                MemberOwner::Interface(owner) => Some(self.hir(file)[owner].name),
                MemberOwner::Class(owner) => Some(self.hir(file)[owner].name),
                _ => None,
            },
            _ => None,
        })
    }

    /// `holder`: as `lib.*.d.ts` names it. `ArrayConstructor` is the static side of `Array`. A holder that the table does not know at all is no
    /// object of the engine: `Intl.NumberFormat`, `URL`. Its values are predictions to begin with, so what is read from a fact of that
    /// type is the claim of whoever annotated it.
    fn is_listed(&self, holder: Atom, name: Atom) -> bool {
        if holder.is_none() || name.is_none() {
            return true;
        }
        let atoms = self.atoms();
        let holder = atoms.bytes(holder);
        let holder = holder.strip_suffix(b"Constructor").filter(|rest| !rest.is_empty()).unwrap_or(holder);
        let holder = ALIASES.iter().find(|alias| alias.0.as_bytes() == holder).map_or(holder, |alias| alias.1.as_bytes());
        let name = atoms.bytes(name);
        let symbol;
        let name = match name.strip_prefix(SYMBOL_NAME_PREFIX) {
            Some(rest) => {
                symbol = [&b"@@"[..], rest].concat();
                &symbol[..]
            }
            None => name,
        };
        let is_typed_array = TYPED_ARRAYS.iter().any(|known| known.as_bytes() == holder);
        if names_of(holder).is_none() && !is_typed_array {
            return true;
        }
        // The iterator protocol has no entries: the engine's iterators and the program's generators implement it.
        let is_protocol = holder == b"Iterator" && matches!(name, b"next" | b"return" | b"throw");
        is_protocol || has_entry(holder, name) || is_typed_array && has_entry(b"TypedArray", name) || has_entry(b"Object", name)
    }

    /// A line for each place where a declaration without a body was taken for a prediction, in the order of the source, after a line with
    /// the counts.
    pub fn explain_predictions(&mut self, predictions: &[(Place, Claim)]) -> Vec<String> {
        let mut counts: Vec<(Claim, usize)> = Vec::new();
        for &(_, claim) in predictions {
            match counts.iter_mut().find(|count| count.0 == claim) {
                Some(count) => count.1 += 1,
                None => counts.push((claim, 1)),
            }
        }
        counts.sort_unstable();
        let total: Vec<String> = counts.iter().map(|(claim, count)| format!("{count} {}", claim.text())).collect();
        let mut lines = vec![format!("predictions: {} places: {}", predictions.len(), total.join(", "))];
        for &(at, claim) in predictions {
            let text = &self.hir(at.file).text;
            let from = (at.pos as usize).min(text.len());
            let line: Vec<u8> = text[from..].iter().copied().take_while(|&byte| byte != b'\n').take(60).collect();
            lines.push(format!("predictions: {}: {}: {}", self.place_for_people(at), claim.text(), String::from_utf8_lossy(&line)));
        }
        lines
    }
}

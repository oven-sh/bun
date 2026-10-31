//! Built-in objects that a file reaches without their names: `Object.getPrototypeOf([])`, `[].__proto__`, `(1).constructor.prototype`,
//! `new Date().constructor`, `Reflect.get(globalThis, "Math")`, `(0, eval)("this").Math`, `held.m` of `{ m: Math }`, `new Proxy(Math, handler)`.
//! A guess at what a test means, like `spelled_values`: nothing is proved by it, and an object too many costs a test where its member is used.
//!
//! EVERY object that an expression may stand for is answered, not the first: `Reflect.get({}, name)` under
//! `describe.each(["constructor", "toString", "__proto__"])` is Object, a function and Object.prototype.
//!
//! Every answer is kept, for all the questions of a file: an expression is looked at once, however many ways lead to it. A helper that is called
//! at thousands of places, which call one another, has more ways through it than anybody can walk.

use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId, MemberLookup, Prototype};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{BinOp, CallId, ExprId, ExprKind, Flags, MemberKey, PropKey, PropKind};
use bun_sema::util::FxHashMap;
use std::rc::Rc;

type Builtins = Rc<[BuiltinId]>;

/// By expression. An answer is empty from when it is first asked for, so a ring of variables names nothing.
#[derive(Default)]
pub(super) struct UnnamedHolders {
    builtins: FxHashMap<ExprId, Builtins>,
    prototypes: FxHashMap<ExprId, Builtins>,
    /// What a variable or a parameter stands for is the same wherever it is named.
    values: FxHashMap<SymbolId, Rc<[ExprId]>>,
}

fn add(found: &mut Vec<BuiltinId>, more: impl IntoIterator<Item = BuiltinId>) {
    for builtin in more {
        if !found.contains(&builtin) {
            found.push(builtin);
        }
    }
}

fn find_member(holder: BuiltinId, name: Option<table::BuiltinName>) -> Option<BuiltinId> {
    match table::member(holder, name?) {
        MemberLookup::Found(member) => Some(table::canonical_id(member)),
        MemberLookup::Unknown | MemberLookup::Absent => None,
    }
}

impl Resolver<'_, '_> {
    pub(super) fn find_builtins_reached_without_names(&self, object: ExprId) -> Vec<BuiltinId> {
        self.find_builtins_behind(object).to_vec()
    }

    /// `find_values_spelled_for`, walked once for a name.
    fn spelled_values_of(&self, expr: ExprId) -> Rc<[ExprId]> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let expr = hir.skip_type_assertions(expr);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[expr].kind, bound.binding(expr))
        else {
            return Rc::new([expr]);
        };
        if let Some(values) = self.unnamed_holders.borrow().values.get(&symbol) {
            return Rc::clone(values);
        }
        let values: Rc<[ExprId]> = self.find_values_spelled_for(expr).into();
        let kept = Rc::clone(&values);
        self.unnamed_holders
            .borrow_mut()
            .values
            .insert(symbol, kept);
        values
    }

    fn find_builtins_behind(&self, expr: ExprId) -> Builtins {
        let expr = self.input.hir.skip_type_assertions(expr);
        if let Some(named) = self.find_builtin(expr) {
            return Rc::new([named]);
        }
        if let Some(answer) = self.unnamed_holders.borrow().builtins.get(&expr) {
            return Rc::clone(answer);
        }
        let open: Builtins = Rc::new([]);
        self.unnamed_holders
            .borrow_mut()
            .builtins
            .insert(expr, open);
        let answer: Builtins = self.look_for_builtins_behind(expr).into();
        let kept = Rc::clone(&answer);
        self.unnamed_holders
            .borrow_mut()
            .builtins
            .insert(expr, kept);
        answer
    }

    fn look_for_builtins_behind(&self, expr: ExprId) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let mut found = Vec::new();
        match hir[expr].kind {
            ExprKind::Ident(_) => {
                // A name of which nothing is known stands for its first mention.
                let is_name = |value: ExprId| matches!(hir[value].kind, ExprKind::Ident(_));
                for &value in self.spelled_values_of(expr).iter() {
                    if !is_name(value) {
                        add(&mut found, self.find_builtins_behind(value).iter().copied());
                    }
                }
            }
            ExprKind::Call(call) => found = self.find_builtins_that_call_answers(call),
            ExprKind::New(call)
                if self.find_builtin(hir[call].callee) == Some(BuiltinId::Proxy) =>
            {
                if let Some(target) = hir.ids(hir[call].args).next() {
                    found = self.find_builtins_behind(target).to_vec();
                }
            }
            _ => {
                let names = match hir.member_key(expr) {
                    Some((_, MemberKey::Name(name))) => vec![name],
                    Some((_, MemberKey::Computed(key))) => self.find_keys_spelled_for(key),
                    Some((_, MemberKey::PrivateName(_))) | None => Vec::new(),
                };
                for name in names {
                    let object = hir.member_key(expr).map(|it| it.0);
                    add(
                        &mut found,
                        object.map_or(Vec::new(), |it| self.find_members_behind(it, name)),
                    );
                }
            }
        }
        found
    }

    fn find_builtins_that_call_answers(&self, call: CallId) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let mut operands = hir.ids(hir[call].args);
        let (first, second) = (operands.next(), operands.next());
        match self.value_of(hir[call].callee).map(|it| it.path.id) {
            Some(BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf) => {
                first.map_or(Vec::new(), |value| self.find_prototypes_of(value).to_vec())
            }
            Some(BuiltinId::ReflectGet) => {
                let (Some(object), Some(key)) = (first, second) else {
                    return Vec::new();
                };
                let mut found = Vec::new();
                for name in self.find_keys_spelled_for(key) {
                    add(&mut found, self.find_members_behind(object, name));
                }
                found
            }
            _ if self.answers_global_object(call) => vec![BuiltinId::GlobalThis],
            _ => Vec::new(),
        }
    }

    // `(0, eval)("this")`, `Function("return this")()`, `new Function("return this")()`. Nobody reads the text here: a member of the global
    // object is looked for behind the call, and a text that answers something else has none.
    fn answers_global_object(&self, call: CallId) -> bool {
        let hir = self.input.hir;
        let mut callee = hir.skip_type_assertions(hir[call].callee);
        while let ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } = hir[callee].kind
        {
            callee = hir.skip_type_assertions(right);
        }
        if self.find_builtin(callee) == Some(BuiltinId::Eval) {
            return true;
        }
        let (ExprKind::Call(maker) | ExprKind::New(maker)) = hir[callee].kind else {
            return false;
        };
        self.find_builtin(hir[maker].callee) == Some(BuiltinId::Function)
    }

    fn find_members_behind(&self, object: ExprId, name: Atom) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let known = self.input.names.get(name);
        let way_up = Some(BuiltinId::ObjectPrototype__proto__);
        if find_member(BuiltinId::ObjectPrototype, known) == way_up {
            return self.find_prototypes_of(object).to_vec();
        }
        let mut found = Vec::new();
        for &value in self.spelled_values_of(object).iter() {
            let holders = self.find_builtins_behind(value);
            // `[].constructor`: what is no built-in object itself finds the member on its prototype.
            let holders = match holders.is_empty() {
                true => self.find_prototypes_of_spelled(value),
                false => holders.to_vec(),
            };
            add(
                &mut found,
                holders.into_iter().filter_map(|it| find_member(it, known)),
            );
            // `held.m` of `{ m: Math }`
            let ExprKind::Object(properties) = hir[value].kind else {
                continue;
            };
            for property in properties.iter().map(|id| hir[id]) {
                let is_value = matches!(property.kind, PropKind::Init | PropKind::Shorthand);
                if is_value && matches!(property.key, PropKey::Name(key) if key == name) {
                    add(
                        &mut found,
                        self.find_builtins_behind(property.value).iter().copied(),
                    );
                }
            }
        }
        found
    }

    fn find_prototypes_of(&self, value: ExprId) -> Builtins {
        let value = self.input.hir.skip_type_assertions(value);
        if let Some(answer) = self.unnamed_holders.borrow().prototypes.get(&value) {
            return Rc::clone(answer);
        }
        let open: Builtins = Rc::new([]);
        self.unnamed_holders
            .borrow_mut()
            .prototypes
            .insert(value, open);
        let mut found = Vec::new();
        for &value in self.spelled_values_of(value).iter() {
            add(&mut found, self.find_prototypes_of_spelled(value));
        }
        let answer: Builtins = found.into();
        let kept = Rc::clone(&answer);
        self.unnamed_holders
            .borrow_mut()
            .prototypes
            .insert(value, kept);
        answer
    }

    fn find_prototypes_of_spelled(&self, value: ExprId) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let value = hir.skip_type_assertions(value);
        let prototype_of_class =
            |class: BuiltinId| find_member(class, table::find_name(b"prototype"));
        let links_of = |objects: Builtins| -> Vec<BuiltinId> {
            let links = objects
                .iter()
                .filter_map(|&object| match table::entry(object).prototype {
                    Prototype::Builtin(prototype) => Some(table::canonical_id(prototype)),
                    Prototype::Unknown | Prototype::Null => None,
                });
            links.collect()
        };
        vec![match hir[value].kind {
            ExprKind::Array(_) => BuiltinId::ArrayPrototype,
            ExprKind::Object(_) => BuiltinId::ObjectPrototype,
            ExprKind::String(_) | ExprKind::Template { .. } => BuiltinId::StringPrototype,
            ExprKind::Number(_) => BuiltinId::NumberPrototype,
            ExprKind::BigInt(_) => BuiltinId::BigIntPrototype,
            ExprKind::True | ExprKind::False => BuiltinId::BooleanPrototype,
            ExprKind::Regex { .. } => BuiltinId::RegExpPrototype,
            ExprKind::Fn(function)
                if !(hir[function].flags).intersects(Flags::ASYNC | Flags::GENERATOR) =>
            {
                BuiltinId::FunctionPrototype
            }
            ExprKind::Fn(_) => return Vec::new(),
            ExprKind::New(call) => {
                let classes = self.find_builtins_behind(hir[call].callee);
                return classes
                    .iter()
                    .filter_map(|&it| prototype_of_class(it))
                    .collect();
            }
            // What a function of a class answers is mostly one of the class: `Promise.resolve()`.
            ExprKind::Call(call) if self.find_builtins_behind(value).is_empty() => {
                let callee = self.value_of(hir[call].callee).map(|it| it.path.id);
                let class = callee.and_then(|it| table::entry(it).holder);
                return class.and_then(prototype_of_class).into_iter().collect();
            }
            _ => return links_of(self.find_builtins_behind(value)),
        }]
    }
}

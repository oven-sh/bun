//! Built-in objects that a file reaches without their names: `Object.getPrototypeOf([])`, `[].__proto__`, `(1).constructor.prototype`,
//! `new Date().constructor`, `Reflect.get(globalThis, "Math")`, `(0, eval)("this").Math`, `held.m` of `{ m: Math }`, `new Proxy(Math, handler)`,
//! `wrap(Math)` of `const wrap = object => new Proxy(object, {})`.
//! A guess at what a test means, like `spelled_values`: nothing is proved by it, and an object too many costs a test where its member is used.
//!
//! EVERY object that an expression may stand for is answered, not the first: `Reflect.get({}, name)` under
//! `describe.each(["constructor", "toString", "__proto__"])` is Object, a function and Object.prototype.
//!
//! Every answer is kept, for all the questions of a file: an expression is looked at once, however many ways lead to it. A helper that is called
//! at thousands of places, which call one another, has more ways through it than anybody can walk.

use super::resolver::Resolver;
use crate::builtins::table::{self, BuiltinId, MemberLookup, Prototype};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{
    BinOp, CallId, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, ImportId, MemberKey,
    MemberKind, PatKind, PropKey, PropKind, StmtKind, VarDeclId,
};
use bun_sema::util::{FxHashMap, FxHashSet};
use std::rc::Rc;

type Builtins = Rc<[BuiltinId]>;

/// By expression. An answer is empty from when it is first asked for, so a ring of variables names nothing.
#[derive(Default)]
pub(super) struct UnnamedHolders {
    builtins: FxHashMap<ExprId, Builtins>,
    prototypes: FxHashMap<ExprId, Builtins>,
    /// What a variable or a parameter stands for is the same wherever it is named.
    values: FxHashMap<SymbolId, Rc<[ExprId]>>,
    /// What each `return` of a function hands back.
    returned: FxHashMap<FnId, Rc<[ExprId]>>,
    /// What a constructor hands out, and whether what it is handed goes into that.
    constructed: FxHashMap<FnId, (Rc<[ExprId]>, bool)>,
    /// What is stored into a variable behind its declaration. Made when it is first asked for.
    stored: Option<Rc<FxHashMap<SymbolId, Vec<ExprId>>>>,
}

/// What the exports of a file hand out, and what has been looked at for it.
#[derive(Default)]
struct HandedOut {
    builtins: Vec<BuiltinId>,
    functions: FxHashSet<FnId>,
    values: FxHashSet<ExprId>,
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

    /// The imports that the object of a write comes out of, each with the names on the way, from the write on:
    /// `make().prototype`, `const made = await make(); made.proxy`, `tools.make()`, `wrap(imported)`, `withProxy(proxy => { proxy .. })`.
    pub(super) fn find_imports_behind(&self, object: ExprId) -> Vec<(ImportId, Vec<Atom>)> {
        let (mut found, mut seen) = (Vec::new(), FxHashSet::default());
        self.push_imports_behind(object, &mut Vec::new(), &mut seen, &mut found);
        found
    }

    fn push_imports_behind(
        &self,
        expr: ExprId,
        path: &mut Vec<Atom>,
        seen: &mut FxHashSet<ExprId>,
        found: &mut Vec<(ImportId, Vec<Atom>)>,
    ) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let expr = hir.skip_type_assertions(expr);
        if !seen.insert(expr) || self.find_builtin(expr).is_some() {
            return;
        }
        match hir[expr].kind {
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(expr) else {
                    return;
                };
                let import = match *bound.symbol(symbol).decls {
                    [Decl::ImportSpec(spec)] => Some(hir[spec].import),
                    [Decl::ImportDefault(import) | Decl::ImportNamespace(import)] => Some(import),
                    _ => None,
                };
                if let Some(import) = import {
                    return found.push((import, path.clone()));
                }
                for &value in self.spelled_values_of(expr).iter() {
                    self.push_imports_behind(value, path, seen, found);
                }
                let whole = self.find_whole_that_name_is_part_of(expr);
                let call = self.find_call_that_calls_back_with(expr);
                for source in whole.into_iter().chain(call) {
                    self.push_imports_behind(source, path, seen, found);
                }
            }
            ExprKind::Call(call) | ExprKind::New(call) => {
                self.push_imports_behind(hir[call].callee, path, seen, found);
                for operand in hir.ids(hir[call].args) {
                    self.push_imports_behind(operand, path, seen, found);
                }
            }
            ExprKind::Await(promised) => self.push_imports_behind(promised, path, seen, found),
            _ => {
                let Some((object, key)) = hir.member_key(expr) else {
                    return;
                };
                let named = matches!(key, MemberKey::Name(_));
                if let MemberKey::Name(name) = key {
                    path.push(name);
                }
                self.push_imports_behind(object, path, seen, found);
                if named {
                    path.pop();
                }
            }
        }
    }

    /// `ResolvedBuiltins::builtins_handed_out`
    pub(super) fn find_builtins_handed_out(&self) -> Vec<BuiltinId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut out = HandedOut::default();
        // `export const proxy = new Proxy(Math, {})`, `const ofMath = () => proxy; export { ofMath }`
        for declaration in (0..hir.var_decls.len() as u32).map(VarDeclId) {
            let declaration = hir[declaration];
            if matches!(hir[declaration.pat].kind, PatKind::Ident(_))
                && declaration.init.is_some()
                && let symbol = bound.declared_symbol(Decl::Var(declaration.pat))
                && symbol.is_some()
                && self.is_exported(symbol)
            {
                self.add_builtins_that_export_hands_out(declaration.init, &mut out);
            }
        }
        // `export function ofMath() { return new Proxy(Math, {}); }`
        for function in (0..hir.fns.len() as u32).map(FnId) {
            if hir[function].kind == FnKind::Decl
                && let symbol = bound.declared_symbol(Decl::Fn(function))
                && symbol.is_some()
                && (self.is_exported(symbol)
                    || (bound.modifier_flags(hir, Decl::Fn(function))).contains(Flags::EXPORT))
            {
                self.add_builtins_that_function_hands_out(function, &mut out);
            }
        }
        for statement in hir.stmts.iter() {
            if let StmtKind::ExportDefault(value) = statement.kind {
                self.add_builtins_that_export_hands_out(value, &mut out);
            }
        }
        out.builtins
    }

    fn add_builtins_that_function_hands_out(&self, function: FnId, out: &mut HandedOut) {
        if out.functions.insert(function) {
            for &returned in self.values_returned_by(function).iter() {
                self.add_builtins_that_export_hands_out(returned, out);
            }
        }
    }

    fn add_builtins_that_export_hands_out(&self, value: ExprId, out: &mut HandedOut) {
        let hir = self.input.hir;
        for &value in self.spelled_values_of(value).iter() {
            // `tools = { ...tools, again: tools }`
            if !out.values.insert(value) {
                continue;
            }
            match hir[value].kind {
                ExprKind::Array(elements) => {
                    for element in hir.ids(elements) {
                        self.add_builtins_that_export_hands_out(element, out);
                    }
                }
                ExprKind::Object(properties) => {
                    for property in properties.iter() {
                        self.add_builtins_that_export_hands_out(hir[property].value, out);
                    }
                }
                _ => {
                    add(
                        &mut out.builtins,
                        self.find_builtins_behind(value).iter().copied(),
                    );
                    for function in self.find_functions_behind(value) {
                        self.add_builtins_that_function_hands_out(function, out);
                    }
                }
            }
        }
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
        let mut values = self.find_values_spelled_for(expr);
        // `let proxy; beforeEach(() => { proxy = wrap(Math); });`
        for &stored in self
            .stores_by_name()
            .get(&symbol)
            .map_or(&[][..], Vec::as_slice)
        {
            values.extend(self.find_values_spelled_for(stored));
        }
        let values: Rc<[ExprId]> = values.into();
        let kept = Rc::clone(&values);
        self.unnamed_holders
            .borrow_mut()
            .values
            .insert(symbol, kept);
        values
    }

    fn stores_by_name(&self) -> Rc<FxHashMap<SymbolId, Vec<ExprId>>> {
        if let Some(stores) = &self.unnamed_holders.borrow().stored {
            return Rc::clone(stores);
        }
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut stores: FxHashMap<SymbolId, Vec<ExprId>> = FxHashMap::default();
        for expr in (0..hir.exprs.len() as u32).map(ExprId) {
            if let ExprKind::Assign {
                op: None | Some(BinOp::Nullish | BinOp::Or | BinOp::And),
                target,
                value,
            } = hir[expr].kind
                && let target = hir.skip_type_assertions(target)
                && matches!(hir[target].kind, ExprKind::Ident(_))
                && let Binding::Symbol(name) = bound.binding(target)
            {
                stores.entry(name).or_default().push(value);
            }
        }
        let stores = Rc::new(stores);
        self.unnamed_holders.borrow_mut().stored = Some(Rc::clone(&stores));
        stores
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
                for &value in self.spelled_values_of(expr).iter() {
                    if value != expr {
                        add(&mut found, self.find_builtins_behind(value).iter().copied());
                    }
                }
                // `const { proxy } = make(Math)`, `const [proxy] = make(Math)`, `for (const proxy of make(Math))`
                if let Some(whole) = self.find_whole_that_name_is_part_of(expr) {
                    add(&mut found, self.find_builtins_that_helpers_answer(whole));
                }
                // `withProxy(Math, proxy => { .. })`, `wrap(Math).then(proxy => { .. })`
                if let Some(call) = self.find_call_that_calls_back_with(expr) {
                    add(&mut found, self.find_builtins_that_helpers_answer(call));
                }
            }
            ExprKind::Call(call) => found = self.find_builtins_that_call_answers(call),
            // `await wrap(Math)` of `const wrap = async object => new Proxy(object, {})`
            ExprKind::Await(promised) => found = self.find_builtins_behind(promised).to_vec(),
            ExprKind::New(call)
                if self.find_builtin(hir[call].callee) == Some(BuiltinId::Proxy) =>
            {
                if let Some(target) = hir.ids(hir[call].args).next() {
                    found = self.find_builtins_behind(target).to_vec();
                }
            }
            ExprKind::New(call) if self.value_of(hir[call].callee).is_none() => {
                found = self.find_builtins_that_construction_answers(call);
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
                // `make(Math).proxy`, `make(Math)[0]`, `Proxy.revocable(Math, {}).proxy`
                if let Some((object, _)) = hir.member_key(expr) {
                    add(&mut found, self.find_builtins_that_helpers_answer(object));
                }
            }
        }
        found
    }

    /// The initializer of the pattern that declares the name.
    fn find_whole_that_name_is_part_of(&self, name: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let Binding::Symbol(symbol) = bound.binding(name) else {
            return None;
        };
        let &[Decl::Var(mut pattern)] = bound.symbol(symbol).decls else {
            return None;
        };
        let mut is_part = false;
        loop {
            match bound.pat_parent[pattern.idx()] {
                PatParent::Elem(whole, _) | PatParent::Prop(whole, _) => {
                    (pattern, is_part) = (whole, true);
                }
                PatParent::Var(declaration) if hir[declaration].init.is_some() => {
                    return is_part.then_some(hir[declaration].init);
                }
                PatParent::Var(declaration) => {
                    let statement = bound.var_stmt[declaration.idx()];
                    let Parent::Stmt(above) = bound.parent_of_stmt(statement) else {
                        return None;
                    };
                    return match hir[above].kind {
                        StmtKind::ForOf { left, expr, .. } if left == statement => Some(expr),
                        _ => None,
                    };
                }
                PatParent::Param(_) | PatParent::None => return None,
            }
        }
    }

    /// The call that is handed the function whose parameter the name is.
    fn find_call_that_calls_back_with(&self, name: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let Binding::Symbol(symbol) = bound.binding(name) else {
            return None;
        };
        let &[Decl::Param(mut pattern)] = bound.symbol(symbol).decls else {
            return None;
        };
        let parameter = loop {
            match bound.pat_parent[pattern.idx()] {
                PatParent::Elem(whole, _) | PatParent::Prop(whole, _) => pattern = whole,
                PatParent::Param(parameter) => break parameter,
                PatParent::Var(_) | PatParent::None => return None,
            }
        };
        let FnOwner::Expr(function) = bound.fns[bound.param_fn[parameter.idx()].idx()].owner else {
            return None;
        };
        let Parent::Expr(above) = bound.parent_of_expr(function) else {
            return None;
        };
        let ExprKind::Call(call) = hir[above].kind else {
            return None;
        };
        (hir.skip_type_assertions(hir[call].callee) != function).then_some(above)
    }

    fn is_call_of_helper(&self, value: ExprId) -> bool {
        let hir = self.input.hir;
        match hir[value].kind {
            ExprKind::Call(call) => matches!(
                self.value_of(hir[call].callee).map(|it| it.path.id),
                None | Some(BuiltinId::ProxyRevocable | BuiltinId::PromiseResolve)
            ),
            ExprKind::New(call) => self.value_of(hir[call].callee).is_none(),
            ExprKind::Await(promised) => self.is_call_of_helper(hir.skip_type_assertions(promised)),
            _ => false,
        }
    }

    /// What a helper answers may hold what stands for a built-in object, under a name or at an index that only the helper knows.
    fn find_builtins_that_helpers_answer(&self, holder: ExprId) -> Vec<BuiltinId> {
        let mut found = Vec::new();
        for &value in self.spelled_values_of(holder).iter() {
            if self.is_call_of_helper(value) {
                add(&mut found, self.find_builtins_behind(value).iter().copied());
            }
        }
        found
    }

    /// The functions of the file that the callee may be: `function wrap(..) { .. }`, `const wrap = .. => ..`, `tools.wrap` of `{ wrap(..) { .. } }`.
    fn find_functions_behind(&self, callee: ExprId) -> Vec<FnId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let callee = hir.skip_type_assertions(callee);
        let mut methods = Vec::new();
        let values: Vec<ExprId> = match hir.member_key(callee) {
            Some((object, MemberKey::Name(name))) => {
                let wholes = self.spelled_values_of(object);
                // `Tools.wrap(..)`, `new Tools().wrap(..)`
                for &whole in wholes.iter() {
                    let (class, is_static) = match hir[whole].kind {
                        ExprKind::New(call) => (hir[call].callee, false),
                        _ => (whole, true),
                    };
                    for class in self.find_classes_behind(class) {
                        let members = hir[class].members.iter().map(|it| hir[it]);
                        methods.extend(
                            members
                                .filter(|it| {
                                    it.kind == MemberKind::Method
                                        && it.flags.contains(Flags::STATIC) == is_static
                                        && matches!(it.key, PropKey::Name(key) if key == name)
                                })
                                .map(|it| it.func),
                        );
                    }
                }
                let parts = wholes.iter();
                let parts = parts.filter_map(|&whole| self.find_property_of_literal(whole, name));
                parts
                    .flat_map(|part| self.spelled_values_of(part).to_vec())
                    .collect()
            }
            _ => self.spelled_values_of(callee).to_vec(),
        };
        let functions =
            values
                .into_iter()
                .filter_map(|value| match (hir[value].kind, bound.binding(value)) {
                    (ExprKind::Fn(function), _) => Some(function),
                    (ExprKind::Ident(_), Binding::Symbol(symbol)) => {
                        match *bound.symbol(symbol).decls {
                            [Decl::Fn(function)] => Some(function),
                            _ => None,
                        }
                    }
                    _ => None,
                });
        methods.extend(functions);
        methods
    }

    /// The classes of the file that the expression may be: `class Tools { .. }`, `const Tools = class { .. }`.
    fn find_classes_behind(&self, class: ExprId) -> Vec<ClassId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let values = self.spelled_values_of(class);
        let classes =
            values
                .iter()
                .filter_map(|&value| match (hir[value].kind, bound.binding(value)) {
                    (ExprKind::Class(class), _) => Some(class),
                    (ExprKind::Ident(_), Binding::Symbol(symbol)) => {
                        match *bound.symbol(symbol).decls {
                            [Decl::Class(class)] => Some(class),
                            _ => None,
                        }
                    }
                    _ => None,
                });
        classes.collect()
    }

    /// What the constructor returns, and what it stores into the object that it makes: `this.proxy = new Proxy(target, {})`.
    fn values_handed_out_by_constructor(&self, constructor: FnId) -> (Rc<[ExprId]>, bool) {
        if let Some(answer) = self.unnamed_holders.borrow().constructed.get(&constructor) {
            return answer.clone();
        }
        let hir = self.input.hir;
        let mut values = self.values_returned_by(constructor).to_vec();
        let statements = match hir[constructor].body {
            FnBody::Block(statements) => hir.ids(statements).map(TreeNode::Stmt).collect(),
            FnBody::Expr(_) | FnBody::None => Vec::new(),
        };
        let mut stack: Vec<TreeNode> = statements;
        while let Some(node) = stack.pop() {
            match node {
                // `this` is another object there.
                TreeNode::Function(function) if hir[function].kind != FnKind::Arrow => continue,
                TreeNode::Class(_) => continue,
                TreeNode::Expr(expr) => {
                    if let ExprKind::Assign { target, value, .. } = hir[expr].kind
                        && let Some((object, _)) = hir.member_key(hir.skip_type_assertions(target))
                        && matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::This)
                    {
                        values.push(value);
                    }
                }
                _ => {}
            }
            push_children(hir, node, &mut stack);
        }
        let takes_what_it_is_handed =
            (values.iter()).any(|&value| self.names_parameter_of(constructor, value));
        let answer: (Rc<[ExprId]>, bool) = (values.into(), takes_what_it_is_handed);
        self.unnamed_holders
            .borrow_mut()
            .constructed
            .insert(constructor, answer.clone());
        answer
    }

    fn names_parameter_of(&self, function: FnId, value: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut stack = vec![TreeNode::Expr(value)];
        while let Some(node) = stack.pop() {
            if let TreeNode::Expr(expr) = node
                && matches!(hir[expr].kind, ExprKind::Ident(_))
                && let Binding::Symbol(symbol) = bound.binding(expr)
                && let [Decl::Param(mut pattern)] = *bound.symbol(symbol).decls
            {
                while let PatParent::Elem(whole, _) | PatParent::Prop(whole, _) =
                    bound.pat_parent[pattern.idx()]
                {
                    pattern = whole;
                }
                if matches!(bound.pat_parent[pattern.idx()], PatParent::Param(it) if bound.param_fn[it.idx()] == function)
                {
                    return true;
                }
            }
            push_children(hir, node, &mut stack);
        }
        false
    }

    /// `new Observed(Math)` of `class Observed { constructor(target) { return new Proxy(target, {}); } }`. Of a class of the file: what its constructor, its fields
    /// and those of the classes above hand out, and what the construction is handed where that goes into it. Of a callee that nobody sees, as of a helper.
    fn find_builtins_that_construction_answers(&self, call: CallId) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let mut classes = self.find_classes_behind(hir[call].callee);
        let mut takes_what_it_is_handed = classes.is_empty();
        let mut found = Vec::new();
        let mut next = 0;
        while let Some(&class) = classes.get(next) {
            next += 1;
            for member in hir[class].members.iter().map(|it| hir[it]) {
                let handed_out: Rc<[ExprId]> = match member.kind {
                    MemberKind::Constructor => {
                        let (values, takes) = self.values_handed_out_by_constructor(member.func);
                        takes_what_it_is_handed |= takes;
                        values
                    }
                    MemberKind::Property
                        if member.init.is_some() && !member.flags.contains(Flags::STATIC) =>
                    {
                        Rc::new([member.init])
                    }
                    _ => continue,
                };
                for &value in handed_out.iter() {
                    for &value in self.spelled_values_of(value).iter() {
                        self.add_builtins_handed_back(value, &mut found);
                    }
                }
            }
            // What a class of the table does is known.
            let Some(above) = (hir[class].extends.some()).filter(|&it| self.value_of(it).is_none())
            else {
                continue;
            };
            let above = self.find_classes_behind(above);
            takes_what_it_is_handed |= above.is_empty();
            for class in above {
                if !classes.contains(&class) {
                    classes.push(class);
                }
            }
        }
        if takes_what_it_is_handed {
            add(&mut found, self.find_builtins_that_helper_answers(call));
        }
        found
    }

    fn values_returned_by(&self, function: FnId) -> Rc<[ExprId]> {
        if let Some(values) = self.unnamed_holders.borrow().returned.get(&function) {
            return Rc::clone(values);
        }
        let hir = self.input.hir;
        let mut values = Vec::new();
        match hir[function].body {
            FnBody::Expr(value) => values.push(value),
            FnBody::Block(statements) => {
                let mut stack: Vec<TreeNode> = hir.ids(statements).map(TreeNode::Stmt).collect();
                while let Some(node) = stack.pop() {
                    // A `return` inside an expression, a function or a class belongs to another function.
                    let TreeNode::Stmt(statement) = node else {
                        continue;
                    };
                    match hir[statement].kind {
                        StmtKind::Return(value) if value.is_some() => values.push(value),
                        _ => push_children(hir, node, &mut stack),
                    }
                }
            }
            FnBody::None => {}
        }
        let values: Rc<[ExprId]> = values.into();
        let kept = Rc::clone(&values);
        self.unnamed_holders
            .borrow_mut()
            .returned
            .insert(function, kept);
        values
    }

    // `{ proxy: new Proxy(object, {}) }`, `[new Proxy(object, {}), revoke]`: the helper's caller takes it apart.
    fn add_builtins_handed_back(&self, value: ExprId, found: &mut Vec<BuiltinId>) {
        let hir = self.input.hir;
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Array(elements) => {
                for element in hir.ids(elements) {
                    self.add_builtins_handed_back(element, found);
                }
            }
            ExprKind::Object(properties) => {
                for property in properties.iter() {
                    self.add_builtins_handed_back(hir[property].value, found);
                }
            }
            _ => add(found, self.find_builtins_behind(value).iter().copied()),
        }
    }

    /// A function that is none of the table's. Handed an object, it mostly answers that object or what stands for it, `wrap(Math)`, and it may lie in another file:
    /// so whatever it is handed. And what it returns, where this file holds it: `const ofMath = () => new Proxy(Math, {})`.
    fn find_builtins_that_helper_answers(&self, call: CallId) -> Vec<BuiltinId> {
        let hir = self.input.hir;
        let mut found = Vec::new();
        for operand in hir.ids(hir[call].args) {
            add(
                &mut found,
                self.find_builtins_behind(operand).iter().copied(),
            );
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        match hir.member_key(callee) {
            // `[Math, JSON].map(wrap)`, `held.take()` of `{ m: Math, take() { return this.m; } }`, `make(Math).take()`
            Some((receiver, _)) => {
                for &value in self.spelled_values_of(receiver).iter() {
                    self.add_builtins_handed_back(value, &mut found);
                }
            }
            // `makeWrap(Math)()`, `wrap.bind(null, Math)()`
            None => add(&mut found, self.find_builtins_that_helpers_answer(callee)),
        }
        for function in self.find_functions_behind(hir[call].callee) {
            for &returned in self.values_returned_by(function).iter() {
                for &value in self.spelled_values_of(returned).iter() {
                    self.add_builtins_handed_back(value, &mut found);
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
            // `{ proxy, revoke }`, and a promise of it
            Some(BuiltinId::ProxyRevocable | BuiltinId::PromiseResolve) => first
                .map_or(Vec::new(), |target| {
                    self.find_builtins_behind(target).to_vec()
                }),
            _ if self.answers_global_object(call) => vec![BuiltinId::GlobalThis],
            // What a function of the table answers is known.
            Some(_) => Vec::new(),
            None => self.find_builtins_that_helper_answers(call),
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
                if !matches!(property.key, PropKey::Name(key) if key == name) {
                    continue;
                }
                match (property.kind, hir[property.value].kind) {
                    (PropKind::Init | PropKind::Shorthand, _) => add(
                        &mut found,
                        self.find_builtins_behind(property.value).iter().copied(),
                    ),
                    // `held.m` of `{ get m() { return new Proxy(Math, {}); } }`
                    (PropKind::Getter, ExprKind::Fn(getter)) => {
                        for &returned in self.values_returned_by(getter).iter() {
                            add(
                                &mut found,
                                self.find_builtins_behind(returned).iter().copied(),
                            );
                        }
                    }
                    _ => {}
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

    /// The functions of the file whose own `prototype` object the value may be: `walk.prototype`, `Object.getPrototypeOf(walk())` of `function* walk() {}`, `new Tool().__proto__`.
    fn find_functions_with_prototype(&self, value: ExprId) -> Vec<FnId> {
        let hir = self.input.hir;
        let is_way_up = |name: Atom| {
            find_member(BuiltinId::ObjectPrototype, self.input.names.get(name))
                == Some(BuiltinId::ObjectPrototype__proto__)
        };
        let made = match (hir[value].kind, hir.member_key(value)) {
            (ExprKind::Call(call), _) => match self.find_builtin(hir[call].callee) {
                Some(BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf) => {
                    hir.ids(hir[call].args).next()
                }
                _ => None,
            },
            (_, Some((function, MemberKey::Name(name)))) if name == known::prototype => {
                return self.find_functions_behind(function);
            }
            (_, Some((made, MemberKey::Name(name)))) if is_way_up(name) => Some(made),
            _ => None,
        };
        let Some(made) = made else {
            return Vec::new();
        };
        let mut functions = Vec::new();
        for &made in self.spelled_values_of(made).iter() {
            match hir[made].kind {
                ExprKind::Call(call) => {
                    let called = self.find_functions_behind(hir[call].callee).into_iter();
                    functions.extend(called.filter(|&it| hir[it].flags.contains(Flags::GENERATOR)));
                }
                ExprKind::New(call) => {
                    functions.extend(self.find_functions_behind(hir[call].callee));
                }
                _ => {}
            }
        }
        functions
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
        let is_async = |function: FnId| hir[function].flags.contains(Flags::ASYNC);
        let is_generator = |function: FnId| hir[function].flags.contains(Flags::GENERATOR);
        // `Object.getPrototypeOf(function* () {})`, `walk.__proto__` of `async function walk() {}`
        let functions = self.find_functions_behind(value);
        if !functions.is_empty() {
            let prototypes = functions.into_iter().map(|function| {
                match (is_async(function), is_generator(function)) {
                    (false, false) => BuiltinId::FunctionPrototype,
                    (true, false) => BuiltinId::AsyncFunctionPrototype,
                    (false, true) => BuiltinId::GeneratorFunctionPrototype,
                    (true, true) => BuiltinId::AsyncGeneratorFunctionPrototype,
                }
            });
            return prototypes.collect();
        }
        let functions = self.find_functions_with_prototype(value);
        if !functions.is_empty() {
            let prototypes = functions.into_iter().map(|function| {
                match (is_async(function), is_generator(function)) {
                    (false, true) => BuiltinId::GeneratorPrototype,
                    (true, true) => BuiltinId::AsyncGeneratorPrototype,
                    (_, false) => BuiltinId::ObjectPrototype,
                }
            });
            return prototypes.collect();
        }
        vec![match hir[value].kind {
            ExprKind::Array(_) => BuiltinId::ArrayPrototype,
            ExprKind::Object(_) => BuiltinId::ObjectPrototype,
            ExprKind::String(_) | ExprKind::Template { .. } => BuiltinId::StringPrototype,
            ExprKind::Number(_) => BuiltinId::NumberPrototype,
            ExprKind::BigInt(_) => BuiltinId::BigIntPrototype,
            ExprKind::True | ExprKind::False => BuiltinId::BooleanPrototype,
            ExprKind::Regex { .. } => BuiltinId::RegExpPrototype,
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

use crate::bun_aot::{
    Alias, Builtin, Change, KnownValue, NameSet, Written, builtin_for_syntax, global_object,
    is_global_object_name, key_name, property_name, root_names, shown, literal_key,
};
use bun_lint::language::RuleOverlaps;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::source::mention_bit;
use bun_lint_oxlint::ast_util::is_global_reference;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Disallow changing the built-in objects that `--aot` makes immutable.
pub struct AotLockedBuiltinWrite {
    /// [`root_names`], each with its [`mention_bit`].
    root_names: Box<[(u32, &'static str)]>,
}

const ADD: Message = Message::new(
    "add",
    "This adds {{property}}, which {{fails}} under `--aot`: built-in prototypes are immutable there. Write a function that takes the value, or a subclass.",
);
const CHANGE: Message = Message::new(
    "change",
    "This changes `{{object}}`, which {{fails}} under `--aot`: built-in prototypes are immutable there. Write a function that takes the value, or a subclass.",
);
const REPLACE: Message = Message::new(
    "replace",
    "This replaces {{property}}, which {{fails}} under `--aot`: built-in objects are immutable there. Call a function of your own where you need something else.",
);
const DELETE: Message = Message::new(
    "delete",
    "This deletes {{property}}, which {{fails}} under `--aot`: built-in objects are immutable there.",
);
const SET_PROTOTYPE: Message = Message::new(
    "setPrototype",
    "This gives `{{object}}` another prototype, which {{fails}} under `--aot`: built-in objects are immutable there.",
);

/// What `--aot` does with a change that it rejects_change.
#[derive(Copy, Clone)]
enum Refusal {
    Throws,
    /// The functions of `Reflect`.
    ReturnsFalse,
}

impl Refusal {
    fn text(self) -> &'static str {
        match self {
            Refusal::Throws => "throws a `TypeError`",
            Refusal::ReturnsFalse => "returns `false` and changes nothing",
        }
    }
}

/// A property of a built-in object.
#[derive(Copy, Clone)]
struct Place<'p, 'a> {
    builtin: &'static Builtin,
    name: &'p [u8],
    alias: Alias<'a>,
}

impl<'a> Place<'_, 'a> {
    /// `Array.prototype.at`, and `Promise` for a property of the global object.
    fn is_named_by(self, e: Expr<'a>) -> bool {
        let e = e.skip_type_wrappers();
        // It starts as what is written to does.
        let is_this = |object: Expr<'a>| {
            property_name(e).is_some_and(|it| *it == *self.name)
                && builtin_for_syntax(object, self.alias)
                    .is_some_and(|it| std::ptr::eq(it.builtin, self.builtin))
        };
        match e.as_ident() {
            Some(name) => {
                self.builtin.is_global_object()
                    && name.bytes() == self.name
                    && is_global_reference(e)
            }
            None => e.object().is_some_and(is_this),
        }
    }

    /// The `at` of `const at = Array.prototype.at;` and of `const { at } = Array.prototype;`
    fn is_saved_in(self, e: Expr<'a>) -> bool {
        let symbol = e.symbol().filter(|it| !it.has_modifying_references());
        let Some(Declaration::Var(bound)) = symbol.and_then(|it| it.declarations().next()) else {
            return false;
        };
        match bound.parent() {
            Node::VarDecl(it) => it.init().is_some_and(|init| self.is_named_by(init)),
            Node::PatProp(property) => {
                let is_this = ast_utils::get_static_property_name(property)
                    .is_some_and(|it| *it == *self.name);
                let from = match property.parent().parent() {
                    Node::VarDecl(it) if is_this && property.default().is_none() => it.init(),
                    _ => None,
                };
                (from.and_then(|it| builtin_for_syntax(it, self.alias)))
                    .is_some_and(|it| std::ptr::eq(it.builtin, self.builtin))
            }
            _ => false,
        }
    }

    /// `Array.prototype.at`, `Array.prototype.at || function () {}`: what is stored is what is there.
    fn is_kept_by(self, value: Expr<'a>) -> bool {
        let value = value.skip_type_wrappers();
        match value.as_binary() {
            Some((BinOp::Or | BinOp::Nullish, left, _)) => self.is_named_by(left),
            _ => {
                self.is_named_by(value)
                    || (value.tag() == ExprTag::Ident && self.is_saved_in(value))
            }
        }
    }
}

/// What a test asks about the built-in objects, which are all there in Bun. It goes by what is written: where the file declares
/// an `Array` of its own, what it does to that is not reported either.
#[derive(Copy, Clone)]
struct Tests<'a> {
    alias: Alias<'a>,
}

impl<'a> Tests<'a> {
    fn known_value(self, e: Expr<'a>) -> Option<KnownValue> {
        let e = e.skip_type_wrappers();
        if e.is_ident("Bun") {
            return Some(KnownValue {
                type_of: "object",
                is_truthy: true,
            });
        }
        let (builtin, name) = match e.as_ident() {
            Some(name) => (Some(global_object()), Some(name.bytes().into())),
            None => {
                let object = e.object().and_then(|it| builtin_for_syntax(it, self.alias));
                (object.map(|it| it.builtin), property_name(e))
            }
        };
        (builtin.zip(name)).and_then(|(builtin, name)| builtin.known_read_result(&name))
    }

    /// `"at"` and `Array.prototype`
    fn has_key(self, key: Expr<'a>, object: Expr<'a>) -> bool {
        (builtin_for_syntax(object, self.alias).zip(key_name(key)))
            .is_some_and(|(object, name)| object.builtin.has(&name))
    }

    /// `Array.prototype.hasOwnProperty("at")`, `Object.hasOwn(Array.prototype, "at")`, `Reflect.has(Array.prototype, "at")`,
    /// `Object.prototype.hasOwnProperty.call(Array.prototype, "at")`
    fn is_asked_by(self, call: Call<'a>) -> bool {
        let (callee, args) = (call.callee(), call.args());
        let Some(name) = callee.member_name() else {
            return false;
        };
        match (name.bytes(), callee.object(), args.first(), args.get(1)) {
            (b"hasOwnProperty", Some(object), Some(key), None) => self.has_key(key, object),
            (b"hasOwn" | b"has" | b"call", _, Some(object), Some(key)) => self.has_key(key, object),
            _ => false,
        }
    }

    /// `Array.prototype.at`, `typeof Array.prototype.at`
    fn is_compared(self, e: Expr<'a>) -> bool {
        match e.skip_type_wrappers().as_unary() {
            Some((UnOp::Typeof, operand)) => self.known_value(operand).is_some(),
            _ => self.known_value(e).is_some(),
        }
    }

    /// Whether `test` is always `answer`, because it asks whether something is there that is.
    fn is_always(self, test: Expr<'a>, answer: bool) -> bool {
        let test = test.skip_type_wrappers();
        match test.kind() {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => self.is_always(operand, !answer),
            // `a && b` is true only if both are, and false if one is.
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                left,
                right,
            } => {
                let (left, right) = (self.is_always(left, answer), self.is_always(right, answer));
                if (op == BinOp::And) == answer {
                    left && right
                } else {
                    left || right
                }
            }
            ExprKind::Binary {
                op: BinOp::In,
                left,
                right,
            } => {
                let found = |(object, name): (Written, Cow<[u8]>)| {
                    let is_found = object.builtin.has_property(&name);
                    (is_found || object.builtin.known_read_result(&name).is_some()).then_some(is_found)
                };
                (builtin_for_syntax(right, self.alias).zip(key_name(left))).and_then(found)
                    == Some(answer)
            }
            ExprKind::Binary { op, left, right } => {
                let is_equal = match op {
                    BinOp::EqEq | BinOp::EqEqEq => true,
                    BinOp::NotEq | BinOp::NotEqEq => false,
                    _ => return false,
                };
                let (asked, with) = if self.is_compared(left) {
                    (left, right)
                } else {
                    (right, left)
                };
                let with = with.skip_type_wrappers();
                let holds = match asked.skip_type_wrappers().as_unary() {
                    Some((UnOp::Typeof, operand)) => match (self.known_value(operand), with.as_string()) {
                        (Some(held), Some(word)) => word.bytes() == held.type_of.as_bytes(),
                        _ => return false,
                    },
                    _ if ast_utils::is_null_or_undefined(with) => {
                        let is_other = with.tag() == ExprTag::Null
                            && matches!(op, BinOp::EqEqEq | BinOp::NotEqEq);
                        !is_other && self.known_value(asked).is_some_and(|it| it.type_of == "undefined")
                    }
                    _ => return false,
                };
                self.is_compared(asked) && (is_equal == holds) == answer
            }
            ExprKind::Call(call) => answer && self.is_asked_by(call),
            _ => self.known_value(test).is_some_and(|it| it.is_truthy == answer),
        }
    }

    /// Whether `e` never runs: `if (!Array.prototype.at) { e }`
    fn keep_from_running(self, e: Expr<'a>) -> bool {
        let mut child = Node::Expr(e);
        for parent in child.ancestors() {
            let is_skipped = match parent {
                Node::Stmt(statement) => match statement.kind() {
                    StmtKind::If { test, yes, no } => {
                        child == Node::Stmt(yes) && self.is_always(test, false)
                            || no.map(Node::Stmt) == Some(child) && self.is_always(test, true)
                    }
                    _ => false,
                },
                Node::Expr(parent) => match parent.kind() {
                    ExprKind::Cond { test, yes, no } => {
                        child == Node::Expr(yes) && self.is_always(test, false)
                            || child == Node::Expr(no) && self.is_always(test, true)
                    }
                    ExprKind::Binary { op, left, right } if child == Node::Expr(right) => {
                        match op {
                            BinOp::Or | BinOp::Nullish => self.is_always(left, true),
                            BinOp::And => self.is_always(left, false),
                            _ => false,
                        }
                    }
                    _ => false,
                },
                _ => false,
            };
            if is_skipped {
                return true;
            }
            child = parent;
        }
        false
    }
}

/// `Array.prototype`, as `no-extend-native` looks for it: written out, with nothing before or around it.
fn is_prototype_for_eslint(e: Expr) -> bool {
    let is_builtin = |it: Name| ast_utils::is_ecmascript_global(it.bytes());
    ast_utils::is_specific_member_access(e, None, Some("prototype"))
        && e.object().and_then(Expr::as_ident).is_some_and(is_builtin)
}

/// What is no object and not `null` is no prototype: `a.__proto__ = 1` does nothing.
fn is_no_prototype(value: Expr) -> bool {
    let value = value.skip_type_wrappers();
    (ast_utils::is_literal(value) && value.tag() != ExprTag::Null && value.tag() != ExprTag::Regex)
        || value.tag() == ExprTag::Template
        || value.is_ident("undefined")
}

fn is_current_prototype<'a>(builtin: &Builtin, value: Expr<'a>, alias: Alias<'a>) -> bool {
    builtin_for_syntax(value, alias).is_some_and(|it| it.builtin.name == builtin.inherits)
}

/// The keys of an object literal, each with where it is. `None`: not all of them are to be seen.
fn written_keys<'a>(e: Expr<'a>) -> Option<impl Iterator<Item = Prop<'a>>> {
    let properties = e.skip_type_wrappers().as_object()?;
    let is_plain = |it: Prop| it.kind() != PropKind::Spread && literal_key(it).is_some();
    properties.iter().all(is_plain).then(|| properties.iter())
}

/// The identifier that `e` starts with: the `a` of `(a as any).b.c`.
#[inline]
fn root_name(mut e: Expr<'_>) -> Option<Name<'_>> {
    loop {
        if let Some(name) = e.as_ident() {
            return Some(name);
        }
        e = match e.tag() {
            ExprTag::Dot | ExprTag::Index => e.object()?,
            ExprTag::As | ExprTag::Satisfies | ExprTag::AsConst | ExprTag::NonNull => {
                e.operand()?
            }
            _ => return None,
        };
    }
}

/// An expression that changes a built-in object, by what is written.
#[derive(Copy, Clone)]
struct Write<'a> {
    whole: Expr<'a>,
    /// The object, and the `Object` of `Object.defineProperty()`.
    written: [Option<Written<'a>>; 2],
    alias: Alias<'a>,
}

impl Write<'_> {
    /// Whether it runs, and these are the built-in objects. Asked last.
    fn is_one(self) -> bool {
        let tests = Tests { alias: self.alias };
        !tests.keep_from_running(self.whole)
            && self.written.iter().flatten().all(|it| it.is_builtin())
    }
}

impl AotLockedBuiltinWrite {
    /// Reports at `at` that `write` makes `change` to the property `name` of `builtin`, if `--aot` rejects_change that.
    fn check_property<'a>(
        at: impl Spanned,
        write: &Write<'a>,
        (builtin, name): (&Builtin, &[u8]),
        change: Change,
        refusal: Refusal,
        cx: &mut Cx<'a, Self>,
    ) {
        if !builtin.rejects_change(name, change) || !write.is_one() {
            return;
        }
        let message = match change {
            Change::Delete => DELETE,
            _ if builtin.has_property(name) => REPLACE,
            _ => ADD,
        };
        cx.report(at, message)
            .data("property", shown(builtin, name))
            .data("fails", refusal.text());
    }

    /// Reports at `at` that `write` changes `builtin`.
    fn report_object<'a>(
        at: impl Spanned,
        write: &Write<'a>,
        (message, builtin): (Message, &Builtin),
        refusal: Refusal,
        cx: &mut Cx<'a, Self>,
    ) {
        if write.is_one() {
            cx.report(at, message)
                .data("object", builtin.name)
                .data("fails", refusal.text());
        }
    }

    /// `target = value`, `target += value`, `target++`, `delete target`, which is `whole`. `op` is that of an assignment.
    fn check_target<'a>(
        whole: Expr<'a>,
        target: Expr<'a>,
        written_as: (Change, Option<BinOp>, Option<Expr<'a>>),
        alias: Alias<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        let (change, op, value) = written_as;
        let target = target.skip_type_wrappers();
        let (written, name) = match target.object() {
            Some(object) => match builtin_for_syntax(object, alias) {
                Some(written) => (written, property_name(target)),
                None => return,
            },
            None => match target.as_ident() {
                Some(name)
                    if change != Change::Delete
                        && cx.state.root_names.has(name)
                        && global_object().has_replaceable(name.bytes()) =>
                {
                    let is_read_only = cx
                        .file()
                        .global(name.bytes())
                        .is_some_and(|it| !it.is_writable);
                    if is_read_only && cx.state.twins.contains(RuleOverlaps::NO_GLOBAL_ASSIGN) {
                        return;
                    }
                    (Written::global_variable(target), Some(name.bytes().into()))
                }
                _ => return,
            },
        };
        if cx.state.twins.contains(RuleOverlaps::NO_EXTEND_NATIVE)
            && whole
                .left()
                .and_then(Expr::object)
                .is_some_and(is_prototype_for_eslint)
        {
            return;
        }
        let (builtin, write) = (
            written.builtin,
            Write {
                whole,
                written: [Some(written), None],
                alias,
            },
        );
        let Some(name) = name else {
            // Whatever the key is, a prototype does not take it.
            if change == Change::Assign && !builtin.is_extensible {
                Self::report_object(target, &write, (CHANGE, builtin), Refusal::Throws, cx);
            }
            return;
        };
        if *name == *b"__proto__" && change == Change::Assign {
            if builtin.has_immutable_prototype()
                && op.is_none()
                && !value.is_some_and(|it| is_no_prototype(it) || is_current_prototype(builtin, it, alias))
            {
                Self::report_object(
                    target,
                    &write,
                    (SET_PROTOTYPE, builtin),
                    Refusal::Throws,
                    cx,
                );
            }
            return;
        }
        if !builtin.rejects_change(&name, change) {
            return;
        }
        // `a ||= b` stores nothing over what is there, `a &&= b` nothing where nothing is.
        let place = Place {
            builtin,
            name: &name,
            alias,
        };
        let held = builtin.known_value(&name);
        let stores_nothing = match op {
            Some(BinOp::Or) => held.is_some_and(|it| it.is_truthy),
            Some(BinOp::Nullish) => held.is_some(),
            Some(BinOp::And) => !held.is_some_and(|it| it.is_truthy),
            Some(_) => false,
            None => builtin.has(&name) && value.is_some_and(|it| place.is_kept_by(it)),
        };
        if !stores_nothing {
            let at = if change == Change::Delete {
                whole
            } else {
                target
            };
            Self::check_property(at, &write, (builtin, &name), change, Refusal::Throws, cx);
        }
    }

    /// `Object.defineProperty(target, ..)` and the like.
    fn check_call<'a>(e: Expr<'a>, alias: Alias<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let callee = call.callee();
        let (Some(holder), Some(called)) = (callee.object(), callee.member_name()) else {
            return;
        };
        let Some(of) = builtin_for_syntax(holder, None) else {
            return;
        };
        let refusal = match of.builtin.name {
            "Object" => Refusal::Throws,
            "Reflect" => Refusal::ReturnsFalse,
            _ => return,
        };
        let (Some(target), second) = (call.args().first(), call.args().get(1)) else {
            return;
        };
        let Some(written) = builtin_for_syntax(target, alias) else {
            return;
        };
        if cx.state.twins.contains(RuleOverlaps::NO_EXTEND_NATIVE)
            && holder.is_ident("Object")
            && matches!(called.bytes(), b"defineProperty" | b"defineProperties")
            && is_prototype_for_eslint(target)
        {
            return;
        }
        let (builtin, write) = (
            written.builtin,
            Write {
                whole: e,
                written: [Some(written), Some(of)],
                alias,
            },
        );
        let one = |change: Change, cx: &mut Cx<'a, Self>| match second.and_then(key_name) {
            Some(name) => {
                Self::check_property(callee, &write, (builtin, &name), change, refusal, cx)
            }
            None if second.is_some()
                && change != Change::Delete
                && !builtin.is_extensible =>
            {
                Self::report_object(callee, &write, (CHANGE, builtin), refusal, cx);
            }
            None => {}
        };
        let is_object = matches!(refusal, Refusal::Throws);
        let change = match called.bytes() {
            b"defineProperty" => return one(Change::Define, cx),
            // With a receiver of its own it stores there.
            b"set" if !is_object && call.args().len() <= 3 => {
                let is_kept = |(name, value): (Cow<[u8]>, Expr<'a>)| {
                    let place = Place {
                        builtin,
                        name: &name,
                        alias,
                    };
                    builtin.has(&name) && place.is_kept_by(value)
                };
                if !(second.and_then(key_name).zip(call.args().get(2))).is_some_and(is_kept) {
                    one(Change::Assign, cx);
                }
                return;
            }
            b"deleteProperty" if !is_object => return one(Change::Delete, cx),
            b"setPrototypeOf"
                if builtin.has_immutable_prototype()
                    && second.is_some_and(|it| !is_current_prototype(builtin, it, alias)) =>
            {
                return Self::report_object(callee, &write, (SET_PROTOTYPE, builtin), refusal, cx);
            }
            b"defineProperties" if is_object => Change::Define,
            b"assign" if is_object => Change::Assign,
            _ => return,
        };
        for source in call.args().iter().skip(1) {
            let Some(keys) = written_keys(source) else {
                if !builtin.is_extensible {
                    return Self::report_object(callee, &write, (CHANGE, builtin), refusal, cx);
                }
                continue;
            };
            if let Some(name) = keys
                .filter_map(literal_key)
                .find(|it| builtin.rejects_change(it, change))
            {
                return Self::check_property(callee, &write, (builtin, &name), change, refusal, cx);
            }
        }
    }

    #[inline(never)]
    fn check<'a>(e: Expr<'a>, alias: Alias<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((op, target, value)) = e.as_assign() {
            return Self::check_target(e, target, (Change::Assign, op, Some(value)), alias, cx);
        }
        match e.as_unary() {
            Some((UnOp::Delete, operand)) => {
                Self::check_target(e, operand, (Change::Delete, None, None), alias, cx);
            }
            Some((UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand)) => {
                Self::check_target(
                    e,
                    operand,
                    (Change::Assign, Some(BinOp::Add), None),
                    alias,
                    cx,
                );
            }
            Some(_) => {}
            None => Self::check_call(e, alias, cx),
        }
    }
}

pub struct State<'a> {
    /// The rules of ESLint that are on and report some of the same places. There this rule says nothing.
    twins: RuleOverlaps,
    prototype: Option<Name<'a>>,
    /// The `P` of `const P = Array.prototype;`, by what is written.
    aliases: SmallVec<[(VarDecl<'a>, Name<'a>, Written<'a>); 4]>,
    /// Those of [`root_names`] that the file has.
    root_names: NameSet,
    methods: NameSet,
}

impl<'a> State<'a> {
    /// Whether `e` can be a built-in object, a property of one or a global variable that names one, by what it starts with.
    /// Nearly nothing can, and this is all that is done with the rest.
    #[inline]
    fn can_concern_a_builtin(&self, e: Expr<'a>) -> bool {
        root_name(e).is_some_and(|it| self.root_names.has(it) && self.continues_as_builtin(e))
    }

    #[inline(never)]
    fn continues_as_builtin(&self, e: Expr<'a>) -> bool {
        let (mut second, mut at) = (None, e.skip_type_wrappers());
        while let Some(object) = at.object() {
            (second, at) = (Some(at), object.skip_type_wrappers());
        }
        match second.and_then(Expr::member_name) {
            Some(name) => {
                self.root_names.has(name.name())
                    || !at.as_ident().is_some_and(is_global_object_name)
            }
            None => true,
        }
    }
}

#[inline]
fn mutated_argument<'a>(methods: &NameSet, call: Call<'a>) -> Option<Expr<'a>> {
    let called = call.callee().member_name()?.name();
    methods.has(called).then(|| call.args().first())?
}

const OBJECT_METHODS: [&str; 4] = [
    "defineProperty",
    "defineProperties",
    "assign",
    "setPrototypeOf",
];
const REFLECT_METHODS: [&str; 4] = ["defineProperty", "set", "deleteProperty", "setPrototypeOf"];
const MUTATING_OPERATORS: [UnOp; 5] = [
    UnOp::Delete,
    UnOp::PreInc,
    UnOp::PreDec,
    UnOp::PostInc,
    UnOp::PostDec,
];
const TARGETS: On = On::new()
    .exprs(&[ExprTag::Assign])
    .unaries(&MUTATING_OPERATORS);
const ALL_CALLS: On = On::new().exprs(&[ExprTag::Call]);
const OBJECT_CALLS: On = On::new().method_calls(&OBJECT_METHODS);
const REFLECT_CALLS: On = On::new().method_calls(&REFLECT_METHODS);
const OBJECT_AND_REFLECT_CALLS: On = OBJECT_CALLS.method_calls(&REFLECT_METHODS);

#[inline]
fn mentions_mutators(file: &File) -> (bool, bool) {
    (
        file.mentions("Object") && file.mentions_any(&OBJECT_METHODS),
        file.mentions("Reflect") && file.mentions_any(&REFLECT_METHODS),
    )
}

#[inline]
fn call_listeners(file: &File) -> On {
    match mentions_mutators(file) {
        (false, false) => On::new(),
        _ if !file.has_calls_by_name() => ALL_CALLS,
        (true, false) => OBJECT_CALLS,
        (false, true) => REFLECT_CALLS,
        (true, true) => OBJECT_AND_REFLECT_CALLS,
    }
}

impl Rule for AotLockedBuiltinWrite {
    const META: Meta = Meta::plugin(Plugin::Bun, "aot-locked-builtin-write", Kind::Problem);
    const ON: On = TARGETS.exprs(&[ExprTag::Call]).var_decls().finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        let mut names: Vec<_> = root_names().collect();
        names.sort_unstable();
        names.dedup();
        AotLockedBuiltinWrite {
            root_names: (names.into_iter())
                .map(|it| (mention_bit(it.as_bytes()), it))
                .collect(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = call_listeners(file)
            .exprs(&[ExprTag::Assign])
            .unaries(&MUTATING_OPERATORS);
        match file.mentions("prototype") {
            true => on.var_decls().finish(),
            false => on,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let mentioned = self.root_names.iter().filter(|it| file.mentions_bit(it.0));
        let root_names: NameSet = mentioned.filter_map(|it| file.find_name(it.1)).collect();
        (!root_names.is_empty()).then(|| State {
            twins: file.active_rule_overlaps(),
            prototype: file.find_name("prototype"),
            aliases: SmallVec::new(),
            root_names,
            methods: {
                let (of_object, of_reflect) = mentions_mutators(file);
                let of_object = OBJECT_METHODS.iter().filter(|_| of_object);
                let of_reflect = REFLECT_METHODS.iter().filter(|_| of_reflect);
                (of_object.chain(of_reflect))
                    .filter_map(|it| file.find_name(it))
                    .collect()
            },
        })
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let first = match e.as_call() {
            Some(call) => mutated_argument(&cx.state.methods, call),
            None => e.left(),
        };
        if first.is_some_and(|it| cx.state.can_concern_a_builtin(it)) {
            Self::check(e, None, cx);
        }
    }

    #[inline]
    fn unary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if e.operand()
            .is_some_and(|it| cx.state.can_concern_a_builtin(it))
        {
            Self::check(e, None, cx);
        }
    }

    /// `const P = Array.prototype;`
    #[inline]
    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let init = match declaration.init() {
            Some(init) if init.tag() == ExprTag::Dot => init,
            Some(init) if init.operand().is_some() => init.skip_type_wrappers(),
            _ => return,
        };
        if cx.state.prototype.is_some()
            && init.member_name().map(Ident::name) == cx.state.prototype
            && let Some(name) = declaration.pat().as_ident()
            && let Some(written) = builtin_for_syntax(init, None)
        {
            cx.state.aliases.push((declaration, name, written));
        }
    }

    /// And then `P.last = ..`. Many files have such a `P`, and few write through it: the scopes are asked where one does.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if cx.state.aliases.is_empty() {
            return;
        }
        let (file, aliases) = (cx.file(), std::mem::take(&mut cx.state.aliases));
        let changes =
            |it: &Expr| (it.unary_op()).is_some_and(|op| MUTATING_OPERATORS.contains(&op));
        let targets = (file.exprs_of_kind(ExprTag::Assign))
            .chain(file.exprs_of_kind(ExprTag::Unary).filter(changes));
        let writes = targets.map(|it| (it, it.left().or_else(|| it.operand())));
        let methods = std::mem::take(&mut cx.state.methods);
        let calls = file.calls_on(&call_listeners(file));
        let calls = calls.map(|it| {
            (
                it,
                it.as_call()
                    .and_then(|call| mutated_argument(&methods, call)),
            )
        });
        for (write, changed) in writes.chain(calls) {
            let start = changed.and_then(root_name);
            let Some((declaration, _, written)) = aliases.iter().find(|it| Some(it.1) == start)
            else {
                continue;
            };
            if let Some(symbol) = declaration.pat().symbol()
                && !symbol.has_modifying_references()
                && written.is_builtin()
            {
                Self::check(write, Some((symbol, written.builtin)), cx);
            }
        }
    }
}

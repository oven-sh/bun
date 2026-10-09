//! Under which names the program is expected to store no number but int32s.
//!
//! A field that holds a number takes eight bytes, and four if the number is an int32. That every number a public field ever holds is
//! one can hardly ever be shown: `pos` comes from a scanner that adds to it, `id` from a counter. So it is not shown. It is expected,
//! and the field is kept so that an int32 takes four bytes and anything else is kept beside the object. What is found here is a
//! prediction: it decides how fast the program is and how much memory it takes, and nothing of what it does. It may be wrong either way.
//! A field of fractions that is expected to hold int32s is slow and large, so what is not known counts for nothing, and one piece of
//! evidence to the contrary settles it.
//!
//! It goes by the name, over the whole program, because fields of one name share their place in the objects. Numbers get from place to
//! place: from a parameter to a property, from a property to a variable, from a variable to what a function returns. Each file says
//! how, in flows between nodes that are the same whoever names them. A flow belongs to the code that runs it, and counts if that code is in
//! the linked program. `expected_int32` puts the flows together.
//!
//! Evidence for an int32: an integer literal that is one; an expression that is shown to be one (`integers_of_expr`: operators on 32
//! bits, values of enum types, masks); `.length`, `.size`, `.index` and the like; `charCodeAt`, `indexOf` and the like; `parseInt`;
//! what `Math.floor`, `ceil`, `round` and `trunc` yield; `++` and `--`. Sums, differences, products and remainders are what their
//! operands are, and so are `Math.min`, `max` and `abs`.
//!
//! Evidence to the contrary: a literal with a fraction or past 2^31; `/`, unless it is rounded on the spot; `**`; `>>>`, unless the result is
//! shown to be an int32; `Math.random`, `sqrt` and the other functions of `Math`; `Date.now`, `performance.now`, and whatever else is
//! called `now` or `getTime`; `parseFloat`; an element of an array of floats or of a `Uint32Array`; whatever code that is only declared
//! declares as `number`; and the number that a method yields of whose name the program has no function, unless the method is optional.
//!
//! Nothing either way: what is not typed and comes from nowhere that is followed, an element of an array, what a function yields that
//! is called by its value, `Number(x)`, a call of an optional method that no object has.
//!
//! In JavaScript no type is asked for: everything goes by the syntax and the names.

use super::Place;
use super::integers::INT32;
use crate::atom::Atom;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::hir::{
    BinOp, ClassId, ExprId, ExprKind, ExprTag, File, FileKind, Flags, FnBody, FnId, Keyword, MemberId, MemberKind, ParamId, PatKind, PatPropId, PropId, PropKey, PropKind,
    StmtId, StmtKind, TypeNodeId, TypeNodeKind, UnOp, VarDeclId, VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{PropSource, TypeId};
use crate::util::FxHashMap;
use smallvec::SmallVec;
use std::hash::Hash;

/// Properties of objects that the program does not make, which are small integers.
const SMALL_PROPERTIES: [&[u8]; 6] = [b"length", b"size", b"index", b"lastIndex", b"byteLength", b"byteOffset"];

/// Methods of such objects that yield small integers.
const SMALL_METHODS: [&[u8]; 32] = [
    b"charCodeAt",
    b"codePointAt",
    b"indexOf",
    b"lastIndexOf",
    b"findIndex",
    b"findLastIndex",
    b"search",
    b"push",
    b"unshift",
    b"localeCompare",
    b"getDate",
    b"getDay",
    b"getFullYear",
    b"getHours",
    b"getMilliseconds",
    b"getMinutes",
    b"getMonth",
    b"getSeconds",
    b"getTimezoneOffset",
    b"getUTCDate",
    b"getUTCDay",
    b"getUTCFullYear",
    b"getUTCHours",
    b"getUTCMilliseconds",
    b"getUTCMinutes",
    b"getUTCMonth",
    b"getUTCSeconds",
    b"getInt8",
    b"getUint8",
    b"getInt16",
    b"getUint16",
    b"getInt32",
];

const ARRAYS_OF_FLOATS: [&[u8]; 2] = [b"Float32Array", b"Float64Array"];
const ARRAYS_OF_UINT32: [&[u8]; 1] = [b"Uint32Array"];

/// Something that numbers get into and come out of. `N`: what a name is called by.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum FlowNode<N = Atom> {
    /// The properties of the name, of whatever objects.
    Property(N),
    /// A variable or a parameter.
    Variable(FileId, SymbolId),
    /// What the function returns.
    Result(FileId, FnId),
    /// What a call `object.name(..)` yields, whatever the object.
    ResultNamed(N),
    /// What such a call passes for the parameter of that number.
    ArgumentNamed(N, u32),
}

impl<N> FlowNode<N> {
    fn renamed<M>(self, rename: &mut impl FnMut(N) -> M) -> FlowNode<M> {
        match self {
            FlowNode::Property(name) => FlowNode::Property(rename(name)),
            FlowNode::Variable(file, symbol) => FlowNode::Variable(file, symbol),
            FlowNode::Result(file, func) => FlowNode::Result(file, func),
            FlowNode::ResultNamed(name) => FlowNode::ResultNamed(rename(name)),
            FlowNode::ArgumentNamed(name, index) => FlowNode::ArgumentNamed(rename(name), index),
        }
    }
}

/// Why a number is not expected to be an int32.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Contrary {
    Fraction,
    Large,
    Division,
    Power,
    Unsigned,
    MathFunction,
    Clock,
    ParsedFraction,
    FloatArray,
    OnlyDeclared,
}

impl Contrary {
    /// Whether rounding does away with it.
    fn is_fraction(self) -> bool {
        matches!(self, Contrary::Fraction | Contrary::Division | Contrary::MathFunction | Contrary::ParsedFraction | Contrary::FloatArray)
    }

    pub fn text(self) -> &'static str {
        match self {
            Contrary::Fraction => "a literal with a fraction",
            Contrary::Large => "a literal that is no int32",
            Contrary::Division => "a division",
            Contrary::Power => "`**`",
            Contrary::Unsigned => "an unsigned number of 32 bits",
            Contrary::MathFunction => "a function of `Math` that yields fractions",
            Contrary::Clock => "a time",
            Contrary::ParsedFraction => "`parseFloat`",
            Contrary::FloatArray => "an element of an array of floats",
            Contrary::OnlyDeclared => "a `number` of code that is only declared",
        }
    }
}

/// Where a number comes from.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum FlowSource<N = Atom> {
    /// From something that yields int32s, as far as anyone would expect.
    Int32,
    Not(Contrary),
    Node(FlowNode<N>),
    /// From `FlowNode::ResultNamed`, where the type of the call says that it yields a number. If no function of the program is a property
    /// of the name, code that is only declared yields it.
    NumberNamed(N),
}

/// Numbers get from `from` to `to`.
#[derive(Copy, Clone, Debug)]
pub struct NumberFlow<N = Atom> {
    pub to: FlowNode<N>,
    pub from: FlowSource<N>,
    /// Where in the file `from` is written.
    pub pos: u32,
}

impl<N> NumberFlow<N> {
    /// The same in terms of other names for the names.
    pub fn renamed<M>(self, mut rename: impl FnMut(N) -> M) -> NumberFlow<M> {
        let from = match self.from {
            FlowSource::Int32 => FlowSource::Int32,
            FlowSource::Not(why) => FlowSource::Not(why),
            FlowSource::Node(node) => FlowSource::Node(node.renamed(&mut rename)),
            FlowSource::NumberNamed(name) => FlowSource::NumberNamed(rename(name)),
        };
        NumberFlow { to: self.to.renamed(&mut rename), from, pos: self.pos }
    }
}

/// The code of a file that runs something.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RunBy {
    /// What evaluates the module.
    Module,
    Function(FnId),
    /// The constructor of the class, declared or not: it initializes the fields of the objects.
    ConstructorOf(ClassId),
}

/// What is found of the properties of one name.
#[derive(Copy, Clone, Debug)]
pub struct Int32Verdict<N> {
    pub name: N,
    /// Something that yields int32s gets there.
    pub is_reached_by_int32: bool,
    /// The first evidence to the contrary that gets there, in the order of the program.
    pub contrary: Option<(Place, Contrary)>,
}

impl<N> Int32Verdict<N> {
    pub fn is_expected_int32(&self) -> bool {
        self.is_reached_by_int32 && self.contrary.is_none()
    }
}

/// `flows`: those of the code that is in the linked program, each with its file. A verdict for every name that a flow has as the name of
/// properties, in the order the flows first come by them. What the verdicts are does not depend on the order of the flows.
pub fn expected_int32<N: Copy + Eq + Hash>(flows: &[(FileId, NumberFlow<N>)], rank_of_file: impl Fn(FileId) -> u32) -> Vec<Int32Verdict<N>> {
    const NONE: u32 = u32::MAX;
    let mut numbers: FxHashMap<FlowNode<N>, u32> = FxHashMap::default();
    let mut nodes: Vec<FlowNode<N>> = Vec::new();
    let mut number_of = |node: FlowNode<N>| {
        *numbers.entry(node).or_insert_with(|| {
            nodes.push(node);
            nodes.len() as u32 - 1
        })
    };
    let mut edges: Vec<(u32, u32)> = Vec::new();
    let mut pending: Vec<u32> = Vec::new();
    // In the order of the program, each with the node it gets to.
    let mut contrary: Vec<((u32, u32, Contrary), FileId, u32)> = Vec::new();
    // `FlowSource::NumberNamed`: the edge, and where it is written.
    let mut numbers_named: Vec<((u32, u32), FileId, u32)> = Vec::new();
    for &(file, flow) in flows {
        let to = number_of(flow.to);
        match flow.from {
            FlowSource::Int32 => pending.push(to),
            FlowSource::Not(why) => contrary.push(((rank_of_file(file), flow.pos, why), file, to)),
            FlowSource::Node(from) => edges.push((number_of(from), to)),
            FlowSource::NumberNamed(name) => {
                let edge = (number_of(FlowNode::ResultNamed(name)), to);
                edges.push(edge);
                numbers_named.push((edge, file, flow.pos));
            }
        }
    }
    let mut is_led_to = vec![false; nodes.len()];
    for &(_, to) in &edges {
        is_led_to[to as usize] = true;
    }
    for ((from, to), file, pos) in numbers_named {
        if !is_led_to[from as usize] {
            contrary.push(((rank_of_file(file), pos, Contrary::OnlyDeclared), file, to));
        }
    }
    edges.sort_unstable();
    edges.dedup();
    // By node: where its edges start.
    let mut starts: Vec<u32> = vec![0; nodes.len() + 1];
    for &(from, _) in &edges {
        starts[from as usize + 1] += 1;
    }
    for node in 0..nodes.len() {
        starts[node + 1] += starts[node];
    }
    let reached_from = |node: u32| edges[starts[node as usize] as usize..starts[node as usize + 1] as usize].iter().map(|edge| edge.1);

    let mut is_reached_by_int32 = vec![false; nodes.len()];
    while let Some(node) = pending.pop() {
        if !std::mem::replace(&mut is_reached_by_int32[node as usize], true) {
            pending.extend(reached_from(node));
        }
    }
    // The first that gets to a node gets to all that the node leads to, so whatever comes later ends there.
    contrary.sort_unstable_by_key(|evidence| evidence.0);
    let mut first: Vec<u32> = vec![NONE; nodes.len()];
    for (index, evidence) in contrary.iter().enumerate() {
        pending.push(evidence.2);
        while let Some(node) = pending.pop() {
            if first[node as usize] == NONE {
                first[node as usize] = index as u32;
                pending.extend(reached_from(node));
            }
        }
    }
    let verdict_of = |(number, node): (usize, &FlowNode<N>)| {
        let FlowNode::Property(name) = *node else { return None };
        let evidence = contrary.get(first[number] as usize);
        Some(Int32Verdict { name, is_reached_by_int32: is_reached_by_int32[number], contrary: evidence.map(|&((_, pos, why), file, _)| (Place { file, pos }, why)) })
    };
    nodes.iter().enumerate().filter_map(verdict_of).collect()
}

type Flows = Vec<(RunBy, NumberFlow)>;
/// Each with where it is written.
type Sources = SmallVec<[(FlowSource, u32); 4]>;

/// What `object.name` gets at.
#[derive(Copy, Clone)]
enum Accessed {
    Node(FlowNode),
    /// A property of objects that the program does not make. Whether it is declared as `number`.
    OnlyDeclared(bool),
}

/// What a call runs.
#[derive(Copy, Clone)]
enum Called {
    /// It is not known, or not followed.
    Unknown,
    /// Code that is only declared. Whether it is declared to return `number`.
    OnlyDeclared(bool),
    Function(FileId, FnId),
    /// Whatever function is a property of that name.
    Named(Atom),
}

fn is_int32(value: f64) -> bool {
    value.fract() == 0.0 && value >= INT32.0 as f64 && value <= INT32.1 as f64
}

/// Whether what is annotated with the type, or not annotated at all, may be a number, as far as the syntax of the type tells.
fn may_annotate_number(hir: &File, node: TypeNodeId) -> bool {
    node.is_none()
        || !matches!(
            hir[node].kind,
            TypeNodeKind::Keyword(
                Keyword::Never | Keyword::Void | Keyword::Undefined | Keyword::Null | Keyword::String | Keyword::Boolean | Keyword::BigInt | Keyword::Symbol | Keyword::Object | Keyword::This
            ) | TypeNodeKind::StringLit(_)
                | TypeNodeKind::BigIntLit { .. }
                | TypeNodeKind::BoolLit(_)
                | TypeNodeKind::Template { .. }
                | TypeNodeKind::Array(_)
                | TypeNodeKind::Tuple(_)
                | TypeNodeKind::Fn(_)
                | TypeNodeKind::Object(_)
        )
}

fn is_number_keyword(hir: &File, node: TypeNodeId) -> bool {
    node.is_some() && matches!(hir[node].kind, TypeNodeKind::Keyword(Keyword::Number))
}

fn has_body(hir: &File, func: FnId) -> bool {
    func.is_some() && !matches!(hir[func].body, FnBody::None)
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what is asked ─────────────────────────────

    /// How numbers get from place to place in the code of the file, each flow with the code that runs it. In an order that follows from
    /// the file.
    pub fn number_flows_in(&mut self, file: FileId) -> Vec<(RunBy, NumberFlow)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut out = Flows::new();
        if matches!(hir.kind, FileKind::Declaration | FileKind::Json) || bound.ran_out_of_stack {
            return out;
        }
        let by_kind = self.exprs_by_kind_of(file);
        for &e in by_kind.of(ExprTag::Assign) {
            self.add_flows_of_assignment(file, e, &mut out);
        }
        for &e in by_kind.of(ExprTag::Unary) {
            self.add_flows_of_update(file, e, &mut out);
        }
        for tag in [ExprTag::Call, ExprTag::New] {
            for &e in by_kind.of(tag) {
                self.add_flows_of_arguments(file, e, &mut out);
            }
        }
        for prop in (0..hir.props.len() as u32).map(PropId) {
            self.add_flows_of_property(file, prop, &mut out);
        }
        for declaration in (0..hir.var_decls.len() as u32).map(VarDeclId) {
            self.add_flows_of_variable(file, declaration, &mut out);
        }
        for prop in (0..hir.pat_props.len() as u32).map(PatPropId) {
            self.add_flows_of_pattern(file, prop, &mut out);
        }
        for param in (0..hir.params.len() as u32).map(ParamId) {
            self.add_flows_of_parameter(file, param, &mut out);
        }
        for stmt in (0..hir.stmts.len() as u32).map(StmtId) {
            if let StmtKind::Return(value) = hir[stmt].kind
                && let Some(RunBy::Function(func)) = self.code_running(file, bound.stmt_parent[stmt.idx()])
            {
                self.add_flows_of_result(file, func, value, &mut out);
            }
        }
        for func in (0..hir.fns.len() as u32).map(FnId) {
            if let FnBody::Expr(value) = hir[func].body {
                self.add_flows_of_result(file, func, value, &mut out);
            }
        }
        for member in (0..hir.members.len() as u32).map(MemberId) {
            self.add_flows_of_member(file, member, &mut out);
        }
        out
    }

    /// A line for each verdict, with the text of the name in the place of the name.
    pub fn explain_int32_fields(&self, verdicts: &[Int32Verdict<&[u8]>]) -> Vec<String> {
        let line_of = |verdict: &Int32Verdict<&[u8]>| {
            let name = String::from_utf8_lossy(verdict.name);
            match verdict.contrary {
                Some((at, why)) => format!("integers: `{name}`: not expected to hold int32s: {} at {}", why.text(), self.place_for_people(at)),
                None if verdict.is_reached_by_int32 => format!("integers: `{name}`: expected to hold int32s"),
                None => format!("integers: `{name}`: nothing is known of the numbers it holds"),
            }
        };
        verdicts.iter().map(line_of).collect()
    }

    // ───────────────────────────── the code that runs something ─────────────────────────────

    /// What runs a direct child of `parent`. `None`: nothing does.
    pub(super) fn code_running(&self, file: FileId, mut parent: Parent) -> Option<RunBy> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return Some(RunBy::Function(func)),
                Parent::ParamDefault(p) => return Some(RunBy::Function(bound.param_fn[p.idx()])),
                // What initializes a static field is run by what evaluates the declaration of the class.
                Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => {
                    let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
                    return Some(RunBy::ConstructorOf(class));
                }
                Parent::File => return Some(RunBy::Module),
                Parent::None => return None,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    // ───────────────────────────── where numbers get to ─────────────────────────────

    /// What the expression yields gets to `to`.
    fn add_flows_to(&mut self, file: FileId, to: FlowNode, value: ExprId, by: RunBy, out: &mut Flows) {
        if self.bound(file).is_unchecked(value.idx()) {
            return;
        }
        let mut sources = Sources::new();
        self.add_sources_of(file, value, false, &mut sources);
        out.extend(sources.into_iter().filter(|source| source.0 != FlowSource::Node(to)).map(|(from, pos)| (by, NumberFlow { to, from, pos })));
    }

    /// `target = value`, `target op= value`
    fn add_flows_of_assignment(&mut self, file: FileId, e: ExprId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Assign { op, target, value } = hir[e].kind else { return };
        // Not what a pattern falls back on: `[target = 1] = list`, `({ target = 1 } = object)`.
        if bound.is_unchecked(e.idx()) || bound.is_shorthand_property_assignment(hir, e) || bound.get_assignment_target(hir, e).is_some() {
            return;
        }
        let Some(by) = self.code_running(file, bound.expr_parent[e.idx()]) else { return };
        let Some(to) = self.node_stored_to(file, target) else { return };
        match op {
            None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                self.add_flows_to(file, to, value, by, out);
                if let FlowNode::Property(name) = to
                    && let Some(function) = self.function_denoted_by(file, value)
                {
                    self.add_flows_of_function_named(name, function, hir[value].pos, by, out);
                }
            }
            Some(_) => self.add_flows_to(file, to, e, by, out),
        }
    }

    /// `target++` and the like: whoever counts, counts in small integers.
    fn add_flows_of_update(&mut self, file: FileId, e: ExprId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand } = hir[e].kind else { return };
        if bound.is_unchecked(e.idx()) {
            return;
        }
        let Some(by) = self.code_running(file, bound.expr_parent[e.idx()]) else { return };
        let Some(to) = self.node_stored_to(file, operand) else { return };
        out.push((by, NumberFlow { to, from: FlowSource::Int32, pos: hir[e].pos }));
    }

    /// Where what is stored to `target` gets. `None`: nowhere that is followed, as with a pattern.
    fn node_stored_to(&mut self, file: FileId, mut target: ExprId) -> Option<FlowNode> {
        let hir = self.hir(file);
        let accessed = loop {
            match hir[target].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => target = expr,
                ExprKind::Ident(name) => {
                    let sym = self.value_named_by(file, target, name)?;
                    let (of, decl @ (Decl::Var(_) | Decl::Param(_))) = self.files().value_declaration(sym)? else { return None };
                    return (!self.is_only_declared_at(of, decl)).then_some(FlowNode::Variable(sym.file, sym.id));
                }
                ExprKind::Dot { obj, name, .. } => break self.property_accessed(file, obj, name),
                ExprKind::Index { obj, index, .. } => {
                    let ExprKind::String(name) = hir[index].kind else { return None };
                    break self.property_accessed(file, obj, name);
                }
                _ => return None,
            }
        };
        match accessed {
            Accessed::Node(node) => Some(node),
            Accessed::OnlyDeclared(_) => None,
        }
    }

    /// The arguments of a call or a `new` get to the parameters.
    fn add_flows_of_arguments(&mut self, file: FileId, e: ExprId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[e].kind else { return };
        if bound.is_unchecked(e.idx()) {
            return;
        }
        let mut given: SmallVec<[(usize, Sources); 4]> = SmallVec::new();
        for (index, argument) in hir.ids(hir[call].args).enumerate() {
            // Which parameters take what comes after it is not known.
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                break;
            }
            let mut sources = Sources::new();
            self.add_sources_of(file, argument, false, &mut sources);
            if !sources.is_empty() {
                given.push((index, sources));
            }
        }
        if given.is_empty() {
            return;
        }
        let Some(by) = self.code_running(file, bound.expr_parent[e.idx()]) else { return };
        let called = self.function_called(file, e);
        for (index, sources) in given {
            let to = match called {
                Called::Function(of, func) => self.parameter_at((of, func), index),
                Called::Named(name) => Some(FlowNode::ArgumentNamed(name, index as u32)),
                Called::Unknown | Called::OnlyDeclared(_) => None,
            };
            let Some(to) = to else { continue };
            out.extend(sources.into_iter().filter(|source| source.0 != FlowSource::Node(to)).map(|(from, pos)| (by, NumberFlow { to, from, pos })));
        }
    }

    /// A property of an object literal, or an attribute of a JSX element.
    fn add_flows_of_property(&mut self, file: FileId, prop: PropId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (p, owner) = (&hir[prop], bound.prop_owner[prop.idx()]);
        let PropKey::Name(name) = p.key else { return };
        // Not where the literal is a pattern: `({ name: target } = object)`.
        if owner.is_none() || p.value.is_none() || bound.is_unchecked(owner.idx()) || bound.get_assignment_target(hir, owner).is_some() {
            return;
        }
        let to = FlowNode::Property(name);
        match (p.kind, hir[p.value].kind) {
            (PropKind::Init | PropKind::Shorthand, _) => {
                let Some(by) = self.code_running(file, Parent::Prop(prop)) else { return };
                self.add_flows_to(file, to, p.value, by, out);
                if let Some(function) = self.function_denoted_by(file, p.value) {
                    self.add_flows_of_function_named(name, function, p.pos, by, out);
                }
            }
            (PropKind::Method, ExprKind::Fn(func)) => self.add_flows_of_function_named(name, (file, func), p.pos, RunBy::Function(func), out),
            (PropKind::Getter, ExprKind::Fn(func)) => out.push((RunBy::Function(func), NumberFlow { to, from: FlowSource::Node(FlowNode::Result(file, func)), pos: p.pos })),
            (PropKind::Setter, ExprKind::Fn(func)) => {
                if let Some(parameter) = self.parameter_at((file, func), 0) {
                    out.push((RunBy::Function(func), NumberFlow { to: parameter, from: FlowSource::Node(to), pos: p.pos }));
                }
            }
            _ => {}
        }
    }

    /// `let name = value`
    fn add_flows_of_variable(&mut self, file: FileId, declaration: VarDeclId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let d = &hir[declaration];
        if d.init.is_none() || d.pat.is_none() || d.flags.contains(Flags::AMBIENT) || !matches!(hir[d.pat].kind, PatKind::Ident(_)) || !may_annotate_number(hir, d.ty) {
            return;
        }
        let Some(symbol) = bound.pat_symbol[d.pat.idx()].some() else { return };
        let Some(by) = self.code_running(file, Parent::VarInit(declaration)) else { return };
        let sym = self.files().sym(file, symbol);
        self.add_flows_to(file, FlowNode::Variable(sym.file, sym.id), d.init, by, out);
    }

    /// `{ key: name = value }` in a declaration or a parameter: the variable gets what the properties of that name hold.
    fn add_flows_of_pattern(&mut self, file: FileId, prop: PatPropId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let p = &hir[prop];
        let PropKey::Name(key) = p.key else { return };
        if p.is_rest || p.value.is_none() || !matches!(hir[p.value].kind, PatKind::Ident(_)) {
            return;
        }
        let Some(symbol) = bound.pat_symbol[p.value.idx()].some() else { return };
        let Some(by) = self.code_running(file, Parent::PatPropDefault(prop)) else { return };
        let sym = self.files().sym(file, symbol);
        let to = FlowNode::Variable(sym.file, sym.id);
        out.push((by, NumberFlow { to, from: FlowSource::Node(FlowNode::Property(key)), pos: p.pos }));
        if p.default.is_some() {
            self.add_flows_to(file, to, p.default, by, out);
        }
    }

    /// What a parameter falls back on, and `constructor(public name: number)`.
    fn add_flows_of_parameter(&mut self, file: FileId, param: ParamId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (p, func) = (&hir[param], bound.param_fn[param.idx()]);
        if p.pat.is_none() || !has_body(hir, func) || !may_annotate_number(hir, p.ty) {
            return;
        }
        let PatKind::Ident(name) = hir[p.pat].kind else { return };
        let Some(symbol) = bound.pat_symbol[p.pat.idx()].some() else { return };
        let sym = self.files().sym(file, symbol);
        let parameter = FlowNode::Variable(sym.file, sym.id);
        if p.default.is_some() {
            self.add_flows_to(file, parameter, p.default, RunBy::Function(func), out);
        }
        if p.flags.contains(Flags::PARAMETER_PROPERTY) {
            out.push((RunBy::Function(func), NumberFlow { to: FlowNode::Property(name), from: FlowSource::Node(parameter), pos: p.pos }));
        }
    }

    /// `return value`, and the body of `() => value`.
    fn add_flows_of_result(&mut self, file: FileId, func: FnId, value: ExprId, out: &mut Flows) {
        let f = &self.hir(file)[func];
        // What such a function returns is not what a call of it yields.
        if value.is_none() || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !may_annotate_number(self.hir(file), f.ret) {
            return;
        }
        self.add_flows_to(file, FlowNode::Result(file, func), value, RunBy::Function(func), out);
    }

    /// A member of a class.
    fn add_flows_of_member(&mut self, file: FileId, member: MemberId, out: &mut Flows) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let m = &hir[member];
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return };
        let (PropKey::Name(name) | PropKey::Private(name)) = m.key else { return };
        if m.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT) || hir[class].flags.contains(Flags::AMBIENT) {
            return;
        }
        let to = FlowNode::Property(name);
        match m.kind {
            MemberKind::Property if m.init.is_some() && may_annotate_number(hir, m.ty) => {
                let Some(by) = self.code_running(file, Parent::MemberInit(member)) else { return };
                self.add_flows_to(file, to, m.init, by, out);
                if let Some(function) = self.function_denoted_by(file, m.init) {
                    self.add_flows_of_function_named(name, function, m.name_pos, by, out);
                }
            }
            MemberKind::Method if has_body(hir, m.func) => self.add_flows_of_function_named(name, (file, m.func), m.name_pos, RunBy::Function(m.func), out),
            MemberKind::Getter if has_body(hir, m.func) => {
                out.push((RunBy::Function(m.func), NumberFlow { to, from: FlowSource::Node(FlowNode::Result(file, m.func)), pos: m.name_pos }));
            }
            MemberKind::Setter if has_body(hir, m.func) => {
                if let Some(parameter) = self.parameter_at((file, m.func), 0) {
                    out.push((RunBy::Function(m.func), NumberFlow { to: parameter, from: FlowSource::Node(to), pos: m.name_pos }));
                }
            }
            _ => {}
        }
    }

    /// The function is a property of the name: `object.name(..)` may call it.
    fn add_flows_of_function_named(&mut self, name: Atom, function: (FileId, FnId), pos: u32, by: RunBy, out: &mut Flows) {
        let hir = self.hir(function.0);
        let f = &hir[function.1];
        if may_annotate_number(hir, f.ret) && !f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            out.push((by, NumberFlow { to: FlowNode::ResultNamed(name), from: FlowSource::Node(FlowNode::Result(function.0, function.1)), pos }));
        }
        for index in 0..f.params.len() {
            if may_annotate_number(hir, hir[f.params.at(index)].ty)
                && let Some(parameter) = self.parameter_at(function, index)
            {
                out.push((by, NumberFlow { to: parameter, from: FlowSource::Node(FlowNode::ArgumentNamed(name, index as u32)), pos }));
            }
        }
    }

    // ───────────────────────────── names, properties, functions ─────────────────────────────

    /// What the name stands for as a value, through imports.
    fn value_named_by(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let sym = self.symbol_of_identifier(file, e, name)?;
        if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym) } else { Some(sym) }
    }

    /// Whether no code of the program stands behind the declaration.
    fn is_only_declared_at(&self, of: FileId, decl: Decl) -> bool {
        let hir = self.hir(of);
        !self.is_compiled(of) || self.bound(of).modifier_flags(hir, decl).contains(Flags::AMBIENT)
    }

    /// Whether the variable, the property or the accessor is declared as `number`, in that word.
    fn is_declared_number(&self, of: FileId, decl: Decl) -> bool {
        let (hir, bound) = (self.hir(of), self.bound(of));
        let node = match decl {
            Decl::Member(member) if hir[member].func.is_some() => hir[hir[member].func].ret,
            Decl::Member(member) => hir[member].ty,
            Decl::Var(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Var(declaration) => hir[declaration].ty,
                _ => TypeNodeId::NONE,
            },
            _ => TypeNodeId::NONE,
        };
        is_number_keyword(hir, node)
    }

    /// `obj.name`
    fn property_accessed(&mut self, file: FileId, obj: ExprId, name: Atom) -> Accessed {
        if self.is_untyped_file(file) {
            return Accessed::Node(FlowNode::Property(name));
        }
        let ty = self.type_of_expr(file, obj);
        if let Some((prop, _)) = self.get_property_of_type(ty, name)
            && let PropSource::Symbol(sym) = &prop.source
        {
            let sym = if self.files().flags(*sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(*sym) } else { Some(*sym) };
            match sym.and_then(|sym| Some((sym, self.files().value_declaration(sym)?))) {
                Some((_, (of, decl))) if self.is_only_declared_at(of, decl) => return Accessed::OnlyDeclared(self.is_declared_number(of, decl)),
                // What a module or a namespace exports.
                Some((sym, (_, Decl::Var(_)))) => return Accessed::Node(FlowNode::Variable(sym.file, sym.id)),
                _ => {}
            }
        }
        Accessed::Node(FlowNode::Property(name))
    }

    /// The declaration with the body that runs where `func` is called, which may be an overload.
    pub(super) fn implementation_of(&self, of: FileId, func: FnId) -> Option<(FileId, FnId)> {
        let (hir, bound) = (self.hir(of), self.bound(of));
        if has_body(hir, func) {
            return Some((of, func));
        }
        match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => {
                let symbol = bound.symbols.get(bound.fn_symbol[func.idx()].idx())?;
                symbol.decls.iter().find_map(|decl| match *decl {
                    Decl::Fn(other) if has_body(hir, other) => Some((of, other)),
                    _ => None,
                })
            }
            FnOwner::Member(member) if hir[member].kind == MemberKind::Constructor => {
                let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
                let constructors = hir[class].members.iter().filter(|&other| hir[other].kind == MemberKind::Constructor);
                constructors.map(|other| hir[other].func).find(|&other| has_body(hir, other)).map(|other| (of, other))
            }
            FnOwner::Member(member) if hir[member].kind == MemberKind::Method => {
                let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
                let symbol = bound.member_symbol[member.idx()].some()?;
                let overloads = hir[class].members.iter().filter(|&other| hir[other].kind == MemberKind::Method && bound.member_symbol[other.idx()] == symbol);
                overloads.map(|other| hir[other].func).find(|&other| has_body(hir, other)).map(|other| (of, other))
            }
            _ => None,
        }
    }

    /// The function of the program that the expression is, for all that the syntax tells: a function expression, the name of a function
    /// declaration, of a class that declares a constructor, or of a `const` that is initialized with a function expression.
    fn function_denoted_by(&mut self, file: FileId, mut e: ExprId) -> Option<(FileId, FnId)> {
        let hir = self.hir(file);
        loop {
            match hir[e].kind {
                ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => e = expr,
                ExprKind::Fn(func) => return Some((file, func)),
                ExprKind::Ident(name) => {
                    let sym = self.value_named_by(file, e, name)?;
                    return match self.files().value_declaration(sym)? {
                        (of, Decl::Fn(func)) => self.implementation_of(of, func),
                        (of, Decl::Class(class)) => {
                            let hir = self.hir(of);
                            hir[class].members.iter().map(|member| &hir[member]).find(|m| m.kind == MemberKind::Constructor && has_body(hir, m.func)).map(|m| (of, m.func))
                        }
                        (of, Decl::Var(pat)) => {
                            let PatParent::Var(declaration) = self.bound(of).pat_parent[pat.idx()] else { return None };
                            let d = &self.hir(of)[declaration];
                            match self.hir(of)[d.init.some()?].kind {
                                ExprKind::Fn(func) if d.kind == VarKind::Const => Some((of, func)),
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                }
                _ => return None,
            }
        }
    }

    /// The parameter of that number, as a variable. `None`: there is none, it is a pattern, or it takes the rest.
    fn parameter_at(&self, (of, func): (FileId, FnId), index: usize) -> Option<FlowNode> {
        let (hir, bound) = (self.hir(of), self.bound(of));
        let params = hir[func].params;
        if index >= params.len() {
            return None;
        }
        let p = &hir[params.at(index)];
        if p.flags.contains(Flags::REST) || p.pat.is_none() || !matches!(hir[p.pat].kind, PatKind::Ident(_)) {
            return None;
        }
        let sym = self.files().sym(of, bound.pat_symbol[p.pat.idx()].some()?);
        Some(FlowNode::Variable(sym.file, sym.id))
    }

    /// `e`: a call or a `new`.
    fn function_called(&mut self, file: FileId, e: ExprId) -> Called {
        let hir = self.hir(file);
        let (call, is_new) = match hir[e].kind {
            ExprKind::Call(call) => (call, false),
            ExprKind::New(call) => (call, true),
            _ => return Called::Unknown,
        };
        let callee = hir[call].callee;
        let named = match hir[callee].kind {
            ExprKind::Dot { name, .. } if !is_new => Called::Named(name),
            _ => Called::Unknown,
        };
        let denoted = |c: &mut Self| c.function_denoted_by(file, callee).map_or(Called::Unknown, |(of, func)| Called::Function(of, func));
        if self.is_untyped_file(file) {
            return if let Called::Named(_) = named { named } else { denoted(self) };
        }
        let Some((of, func, _)) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig)) else {
            return if let Called::Named(_) = named { named } else { denoted(self) };
        };
        let declared_in = self.hir(of);
        if !self.is_compiled(of) || declared_in[func].flags.contains(Flags::AMBIENT) {
            return Called::OnlyDeclared(is_number_keyword(declared_in, declared_in[func].ret));
        }
        let implementation = |c: &Self| c.implementation_of(of, func).map_or(Called::Unknown, |(of, func)| Called::Function(of, func));
        match self.bound(of).fns[func.idx()].owner {
            FnOwner::Stmt(_) => implementation(self),
            FnOwner::Member(member) if declared_in[member].kind == MemberKind::Constructor => implementation(self),
            // A method may be overridden, and a signature of an interface is whatever the object has there.
            FnOwner::Member(member) => declared_in[member].key.name().map_or(named, Called::Named),
            FnOwner::Expr(_) if matches!(named, Called::Unknown) => implementation(self),
            _ => named,
        }
    }

    // ───────────────────────────── where numbers come from ─────────────────────────────

    fn may_be_number(&self, ty: TypeId) -> bool {
        ty.is_any() || ty == TypeId::UNKNOWN || self.some_type(ty, |c, part| c.is_number_like(part))
    }

    /// Where the numbers come from that the expression yields. `is_rounded`: what comes after the point is dropped from what it yields.
    fn add_sources_of(&mut self, file: FileId, e: ExprId, is_rounded: bool, out: &mut Sources) {
        if e.is_none() || self.is_half_of_stack_in_use() {
            return;
        }
        let hir = self.hir(file);
        let (kind, pos) = (hir[e].kind, hir[e].pos);
        // What yields one of its operands as it is.
        let operands = match kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) | ExprKind::Instantiation { expr, .. } => [expr, ExprId::NONE],
            ExprKind::Binary { op: BinOp::Comma, right, .. } => [right, ExprId::NONE],
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => [left, right],
            ExprKind::Assign { op: None, value, .. } => [value, ExprId::NONE],
            ExprKind::Assign { op: Some(BinOp::And | BinOp::Or | BinOp::Nullish), target, value } => [target, value],
            ExprKind::Cond { yes, no, .. } => [yes, no],
            _ => [ExprId::NONE, ExprId::NONE],
        };
        if operands[0].is_some() {
            for operand in operands {
                self.add_sources_of(file, operand, is_rounded, out);
            }
            return;
        }
        let add_contrary = |why: Contrary, out: &mut Sources| {
            if !(is_rounded && why.is_fraction()) {
                out.push((FlowSource::Not(why), pos));
            }
        };
        if let ExprKind::Number(index) = kind {
            let value = hir.numbers[index as usize];
            if is_int32(value) {
                out.push((FlowSource::Int32, pos));
            } else {
                add_contrary(if value.fract() != 0.0 { Contrary::Fraction } else { Contrary::Large }, out);
            }
            return;
        }
        if !self.is_untyped_file(file) {
            let ty = self.type_of_expr(file, e);
            if !self.may_be_number(ty) {
                return;
            }
            if self.integers_of_expr(file, e).is_some_and(|(least, most)| least >= INT32.0 && most <= INT32.1) {
                out.push((FlowSource::Int32, pos));
                return;
            }
        }
        let arithmetic = match kind {
            ExprKind::Binary { op, left, right } => Some((op, left, right)),
            ExprKind::Assign { op: Some(op), target, value } => Some((op, target, value)),
            _ => None,
        };
        if let Some((op, left, right)) = arithmetic {
            match op {
                BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem => {}
                BinOp::Div if is_rounded => {}
                BinOp::Div => return add_contrary(Contrary::Division, out),
                BinOp::Pow => return add_contrary(Contrary::Power, out),
                BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr => return out.push((FlowSource::Int32, pos)),
                BinOp::UShr => return add_contrary(Contrary::Unsigned, out),
                _ => return,
            }
            self.add_sources_of(file, left, is_rounded, out);
            self.add_sources_of(file, right, is_rounded, out);
            return;
        }
        match kind {
            ExprKind::Ident(name) => {
                let Some(sym) = self.value_named_by(file, e, name) else { return };
                let Some((of, decl @ (Decl::Var(_) | Decl::Param(_)))) = self.files().value_declaration(sym) else { return };
                if !self.is_only_declared_at(of, decl) {
                    out.push((FlowSource::Node(FlowNode::Variable(sym.file, sym.id)), pos));
                // `NaN`, `Infinity`
                } else if self.is_declared_number(of, decl) {
                    add_contrary(Contrary::OnlyDeclared, out);
                }
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Minus | UnOp::Plus => self.add_sources_of(file, operand, is_rounded, out),
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    out.push((FlowSource::Int32, pos));
                    self.add_sources_of(file, operand, is_rounded, out);
                }
                UnOp::BitNot => out.push((FlowSource::Int32, pos)),
                UnOp::Not | UnOp::Typeof | UnOp::Void | UnOp::Delete => {}
            },
            ExprKind::Dot { obj, name, .. } => self.add_sources_of_access(file, obj, name, pos, out),
            ExprKind::Index { obj, index, .. } => {
                if let ExprKind::String(name) = hir[index].kind {
                    return self.add_sources_of_access(file, obj, name, pos, out);
                }
                if self.is_untyped_file(file) {
                    return;
                }
                let ty = self.type_of_expr(file, obj);
                if !ty.is_never() && self.every_type(ty, |c, part| c.is_instance_of_global(part, &ARRAYS_OF_FLOATS)) {
                    add_contrary(Contrary::FloatArray, out);
                } else if !ty.is_never() && self.every_type(ty, |c, part| c.is_instance_of_global(part, &ARRAYS_OF_UINT32)) {
                    add_contrary(Contrary::Unsigned, out);
                }
            }
            ExprKind::Call(_) => self.add_sources_of_call(file, e, is_rounded, out),
            _ => {}
        }
    }

    /// `obj.name`, which is written at `pos`.
    fn add_sources_of_access(&mut self, file: FileId, obj: ExprId, name: Atom, pos: u32, out: &mut Sources) {
        let is_small = SMALL_PROPERTIES.contains(&self.atoms().bytes(name));
        match self.property_accessed(file, obj, name) {
            Accessed::Node(node) => {
                // Whether the program makes the object is not known there.
                if is_small && self.is_untyped_file(file) {
                    out.push((FlowSource::Int32, pos));
                }
                out.push((FlowSource::Node(node), pos));
            }
            Accessed::OnlyDeclared(_) if is_small => out.push((FlowSource::Int32, pos)),
            Accessed::OnlyDeclared(true) => out.push((FlowSource::Not(Contrary::OnlyDeclared), pos)),
            Accessed::OnlyDeclared(false) => {}
        }
    }

    /// `e`: a call.
    fn add_sources_of_call(&mut self, file: FileId, e: ExprId, is_rounded: bool, out: &mut Sources) {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return };
        let (callee, args, pos) = (hir[call].callee, hir[call].args, hir[e].pos);
        let add_contrary = |why: Contrary, out: &mut Sources| {
            if !(is_rounded && why.is_fraction()) {
                out.push((FlowSource::Not(why), pos));
            }
        };
        let mut method: &[u8] = b"";
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                method = self.atoms().bytes(name);
                if self.names_global_object(file, obj, b"Math") {
                    let is_rounding = matches!(method, b"floor" | b"ceil" | b"round" | b"trunc");
                    match method {
                        b"floor" | b"ceil" | b"round" | b"trunc" | b"sign" | b"imul" | b"clz32" => out.push((FlowSource::Int32, pos)),
                        b"min" | b"max" | b"abs" => {}
                        _ => return add_contrary(Contrary::MathFunction, out),
                    }
                    if !matches!(method, b"sign" | b"imul" | b"clz32") {
                        for argument in hir.ids(args) {
                            self.add_sources_of(file, argument, is_rounded || is_rounding, out);
                        }
                    }
                    return;
                }
                if method == b"now" && (self.names_global_object(file, obj, b"Date") || self.names_global_object(file, obj, b"performance")) {
                    return add_contrary(Contrary::Clock, out);
                }
                if self.names_global_object(file, obj, b"Number") {
                    match method {
                        b"parseInt" => out.push((FlowSource::Int32, pos)),
                        b"parseFloat" => add_contrary(Contrary::ParsedFraction, out),
                        _ => {}
                    }
                    return;
                }
            }
            ExprKind::Ident(name) => {
                if self.names_global_object(file, callee, b"parseInt") {
                    return out.push((FlowSource::Int32, pos));
                }
                if self.names_global_object(file, callee, b"parseFloat") {
                    return add_contrary(Contrary::ParsedFraction, out);
                }
                if self.names_global_object(file, callee, b"Number") {
                    return;
                }
                // The type of a variable says how it can be called, not which of the functions it is initialized with is.
                if let Some(sym) = self.value_named_by(file, callee, name)
                    && let Some((_, Decl::Var(_))) = self.files().value_declaration(sym)
                {
                    return self.add_sources_of_calling(file, callee, pos, 0, out);
                }
            }
            _ => {}
        }
        let (is_small, is_clock) = (SMALL_METHODS.contains(&method), matches!(method, b"now" | b"getTime"));
        match self.function_called(file, e) {
            Called::Unknown => self.add_sources_of_calling(file, callee, pos, 0, out),
            Called::OnlyDeclared(_) if is_small => out.push((FlowSource::Int32, pos)),
            Called::OnlyDeclared(_) if is_clock => add_contrary(Contrary::Clock, out),
            Called::OnlyDeclared(is_number) => {
                if is_number {
                    add_contrary(Contrary::OnlyDeclared, out);
                }
            }
            Called::Function(of, func) => out.push((FlowSource::Node(FlowNode::Result(of, func)), pos)),
            Called::Named(name) => {
                // An interface of the program may stand for an object that the program does not make.
                if is_clock {
                    add_contrary(Contrary::Clock, out);
                }
                if self.is_untyped_file(file) {
                    if is_small {
                        out.push((FlowSource::Int32, pos));
                    }
                    return out.push((FlowSource::Node(FlowNode::ResultNamed(name)), pos));
                }
                let ty = self.type_of_expr(file, e);
                let is_number = !ty.is_never() && self.every_type(ty, |c, part| c.is_number_like(part) || part.is_undefined() || part.is_null());
                // `host.now ? host.now() : 0`: where no function of the program is a property of the name, nothing need have the method.
                let declared = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig));
                let is_optional = declared.is_some_and(|(of, func, _)| matches!(self.bound(of).fns[func.idx()].owner, FnOwner::Member(member) if self.hir(of)[member].flags.contains(Flags::OPTIONAL)));
                out.push((if is_number && !is_optional { FlowSource::NumberNamed(name) } else { FlowSource::Node(FlowNode::ResultNamed(name)) }, pos));
            }
        }
    }

    /// Where the numbers come from that a call of what `callee` yields, yields: `const now = fast ? () => clock.now() : Date.now; now()`. The
    /// call is written at `pos`. `depth`: how many names of constants have been followed.
    fn add_sources_of_calling(&mut self, file: FileId, callee: ExprId, pos: u32, depth: u32, out: &mut Sources) {
        /// Beyond that nothing is found.
        const DEEPEST: u32 = 4;
        if callee.is_none() || self.is_half_of_stack_in_use() {
            return;
        }
        let operands = match self.hir(file)[callee].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => [expr, ExprId::NONE],
            ExprKind::Cond { yes, no, .. } => [yes, no],
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => [left, right],
            ExprKind::Fn(func) => return out.push((FlowSource::Node(FlowNode::Result(file, func)), pos)),
            ExprKind::Ident(name) => {
                let Some(sym) = self.value_named_by(file, callee, name) else { return };
                match self.files().value_declaration(sym) {
                    Some((of, Decl::Fn(func))) => out.extend(self.implementation_of(of, func).map(|(of, func)| (FlowSource::Node(FlowNode::Result(of, func)), pos))),
                    Some((of, Decl::Var(pat))) if depth < DEEPEST => {
                        let PatParent::Var(declaration) = self.bound(of).pat_parent[pat.idx()] else { return };
                        let d = &self.hir(of)[declaration];
                        if d.kind == VarKind::Const {
                            self.add_sources_of_calling(of, d.init, pos, depth + 1, out);
                        }
                    }
                    _ => {}
                }
                return;
            }
            ExprKind::Dot { obj, name, .. } => {
                let is_clock = matches!(self.atoms().bytes(name), b"now" | b"getTime");
                match self.property_accessed(file, obj, name) {
                    _ if is_clock => out.push((FlowSource::Not(Contrary::Clock), pos)),
                    Accessed::OnlyDeclared(true) => out.push((FlowSource::Not(Contrary::OnlyDeclared), pos)),
                    Accessed::Node(FlowNode::Property(name)) => out.push((FlowSource::Node(FlowNode::ResultNamed(name)), pos)),
                    _ => {}
                }
                return;
            }
            _ => return,
        };
        for operand in operands {
            self.add_sources_of_calling(file, operand, pos, depth, out);
        }
    }
}

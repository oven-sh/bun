#![allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    unreachable_pub,
    dead_code,
    reason = "ported from facebook/react react_compiler_hir; uses std collections by design"
)]
#![allow(
    clippy::borrow_as_ptr,
    clippy::clone_on_copy,
    clippy::derivable_impls,
    clippy::format_collect,
    clippy::if_same_then_else,
    clippy::large_enum_variant,
    clippy::let_and_return,
    clippy::manual_map,
    clippy::map_entry,
    clippy::match_like_matches_macro,
    clippy::needless_borrow,
    clippy::needless_borrows_for_generic_args,
    clippy::needless_pass_by_value,
    clippy::neg_multiply,
    clippy::or_fun_call,
    clippy::ptr_arg,
    clippy::redundant_clone,
    clippy::redundant_closure,
    clippy::trivially_copy_pass_by_ref,
    clippy::unnecessary_map_or,
    clippy::unnecessary_unwrap,
    clippy::unwrap_or_default,
    clippy::useless_conversion,
    clippy::useless_format,
    reason = "ported verbatim from facebook/react upstream; not maintained for Rust idioms"
)]

pub mod cfg_utils;
pub mod default_module_type_provider;
pub mod dominator;
pub mod environment;
pub mod environment_config;
pub mod globals;
pub mod object_shape;
pub mod print;
pub mod reactive;
pub mod type_config;
pub mod visitors;

use crate::collections::IndexMap;
use crate::collections::IndexSet;
pub use crate::diagnostics::CompilerDiagnostic;
pub use crate::diagnostics::ErrorCategory;
pub use crate::diagnostics::GENERATED_SOURCE;
pub use crate::diagnostics::Position;
pub use crate::diagnostics::SourceLocation;
pub use reactive::*;

// =============================================================================
// Arena-backed Vec for HIR data
// =============================================================================

/// `Vec` whose backing buffer lives in the parser's thread-local AST arena
/// (see [`bun_alloc::AstAlloc`]). Same layout as `Vec<T>` (the allocator is a
/// ZST), so HIR types are unchanged in size. The arena is installed for the
/// duration of `js_parser`'s visit pass — the hook point that calls into this
/// compiler — so every `HirVec` allocated during a `compile_fn` lands in the
/// per-file arena and is bulk-freed with the rest of the AST.
///
/// `Drop` on a `HirVec<T>` still runs each element's `Drop`; only the backing
/// buffer's `deallocate` is a no-op. Nonetheless, HIR types must NOT own
/// global-heap allocations (`String`, `Box<T>`, `Vec<T>`): the arena bulk-
/// frees on reset without walking elements, so any nested global allocation
/// leaks per parse. Use [`StoreStr`] / [`HirBox`] / [`HirVec`] instead.
pub type HirVec<T> = bun_alloc::AstVec<T>;
/// Arena-backed `Box<T>`. See [`HirVec`] for the leak rationale.
pub type HirBox<T> = bun_alloc::AstBox<T>;
pub use bun_alloc::AstAlloc;
/// Arena-owned (or `'static`) byte string. Copy; no Drop. See [`HirVec`].
pub use bun_ast::StoreStr;

/// `vec![..]` for [`HirVec`]. `Vec<T, A>` has no `Default`/`From<[T; N]>` for
/// non-`Global` `A`, so the std macro doesn't apply.
#[macro_export]
macro_rules! hir_vec {
    () => {
        ::bun_alloc::AstAlloc::vec()
    };
    ($($x:expr),+ $(,)?) => {{
        let mut v = ::bun_alloc::AstAlloc::vec();
        $(v.push($x);)+
        v
    }};
}
pub use crate::hir_vec;

// =============================================================================
// ID newtypes
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct BlockId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct IdentifierId(pub u32);

/// Index into the flat instruction table on HirFunction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct InstructionId(pub u32);

/// Evaluation order assigned to instructions and terminals during numbering.
/// This was previously called InstructionId in the TypeScript compiler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EvaluationOrder(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DeclarationId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ScopeId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TypeId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FunctionId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MutableRangeId(pub u32);

macro_rules! impl_u32_id {
    ($($t:ty),* $(,)?) => {$(
        impl From<$t> for u32 {
            #[inline]
            fn from(id: $t) -> u32 { id.0 }
        }
        impl From<u32> for $t {
            #[inline]
            fn from(n: u32) -> Self { Self(n) }
        }
    )*};
}
impl_u32_id!(BlockId, IdentifierId, InstructionId, DeclarationId, ScopeId);

// =============================================================================
// FloatValue wrapper
// =============================================================================

/// Wrapper around f64 that stores raw bytes for deterministic equality and hashing.
/// This allows use in HashMap keys and ensures NaN == NaN (bitwise comparison).
#[derive(Debug, Clone, Copy)]
pub struct FloatValue(u64);

impl FloatValue {
    pub fn new(value: f64) -> Self {
        FloatValue(value.to_bits())
    }

    pub fn value(self) -> f64 {
        f64::from_bits(self.0)
    }
}

impl From<f64> for FloatValue {
    fn from(value: f64) -> Self {
        FloatValue::new(value)
    }
}

impl From<FloatValue> for f64 {
    fn from(value: FloatValue) -> Self {
        value.value()
    }
}

impl PartialEq for FloatValue {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl Eq for FloatValue {}

impl std::hash::Hash for FloatValue {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.hash(state);
    }
}

impl std::fmt::Display for FloatValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write_js_number(f, self.value())
    }
}

/// Write an f64 the way JavaScript's `Number.prototype.toString()` does.
///
/// Key differences from Rust's default `Display`:
/// - Uses scientific notation for |x| >= 1e21 (e.g. `1e+21`, `2.18739127891275e+22`)
/// - Uses scientific notation for 0 < |x| < 1e-6 (e.g. `1e-7`, `1.5e-8`)
/// - Uses minimal significant digits that round-trip to the same f64
/// - Formats -0 as "0"
pub fn write_js_number(w: &mut impl core::fmt::Write, n: f64) -> core::fmt::Result {
    if n.is_nan() {
        return w.write_str("NaN");
    }
    if n.is_infinite() {
        return w.write_str(if n > 0.0 { "Infinity" } else { "-Infinity" });
    }
    if n == 0.0 {
        return w.write_str("0");
    }

    let abs = n.abs();
    let sign = if n < 0.0 { "-" } else { "" };

    if abs >= 1e21 || (abs > 0.0 && abs < 1e-6) {
        // Use scientific notation matching JS format: coefficient + "e+" or "e-" + exponent
        // Rust's {:e} uses "e" (lowercase) like JS, but formats as e.g. "1.5e21" not "1.5e+21".
        // Render the LowerExp form into a small stack buffer to split coefficient/exponent
        // without a heap allocation (longest f64 {:e} form is well under 32 bytes).
        use core::fmt::Write as _;
        let mut buf = [0u8; 32];
        let mut cursor = StackCursor {
            buf: &mut buf,
            len: 0,
        };
        write!(cursor, "{:e}", abs)?;
        let formatted = cursor.as_str();
        // Split into coefficient and exponent parts
        let (coeff, exp_str) = formatted.split_once('e').unwrap();
        let exp: i32 = exp_str.parse().unwrap();
        // JS uses e+N for positive exponents, e-N for negative
        if exp >= 0 {
            write!(w, "{}{}e+{}", sign, coeff, exp)
        } else {
            write!(w, "{}{}e-{}", sign, coeff, exp.unsigned_abs())
        }
    } else if abs.fract() == 0.0 && abs < (i64::MAX as f64) {
        // Integer that fits in i64 — format without decimal point
        write!(w, "{}{}", sign, abs as i64)
    } else {
        // Regular float: Rust's default Display gives us the right digits
        write!(w, "{}", n)
    }
}

/// Allocating wrapper around [`write_js_number`]. Prefer the writer form on
/// hot paths; this exists for callers that need an owned `String` (e.g.
/// constant folding `String(n)`).
pub fn format_js_number(n: f64) -> String {
    let mut s = String::new();
    write_js_number(&mut s, n).unwrap();
    s
}

struct StackCursor<'a> {
    buf: &'a mut [u8],
    len: usize,
}
impl StackCursor<'_> {
    #[inline]
    fn as_str(&self) -> &str {
        // SAFETY: `core::fmt::LowerExp` for f64 emits only ASCII.
        unsafe { core::str::from_utf8_unchecked(&self.buf[..self.len]) }
    }
}
impl core::fmt::Write for StackCursor<'_> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        let bytes = s.as_bytes();
        let dst = self
            .buf
            .get_mut(self.len..self.len + bytes.len())
            .ok_or(core::fmt::Error)?;
        dst.copy_from_slice(bytes);
        self.len += bytes.len();
        Ok(())
    }
}

// =============================================================================
// Core HIR types
// =============================================================================

/// A function lowered to HIR form
#[derive(Debug, Clone)]
pub struct HirFunction {
    pub loc: Option<SourceLocation>,
    pub id: Option<StoreStr>,
    pub name_hint: Option<StoreStr>,
    pub fn_type: ReactFunctionType,
    pub params: HirVec<ParamPattern>,
    pub return_type_annotation: Option<StoreStr>,
    pub returns: Place,
    pub context: HirVec<Place>,
    pub body: HIR,
    pub instructions: HirVec<Instruction>,
    pub generator: bool,
    pub is_async: bool,
    pub directives: HirVec<StoreStr>,
    pub aliasing_effects: Option<HirVec<AliasingEffect>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReactFunctionType {
    Component,
    Hook,
    Other,
}

#[derive(Debug, Clone)]
pub enum ParamPattern {
    Place(Place),
    Spread(SpreadPattern),
}

/// The HIR control-flow graph
#[derive(Debug, Clone)]
pub struct HIR {
    pub entry: BlockId,
    pub blocks: IndexMap<BlockId, BasicBlock>,
}

/// Block kinds
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Block,
    Value,
    Loop,
    Sequence,
    Catch,
}

impl std::fmt::Display for BlockKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlockKind::Block => write!(f, "block"),
            BlockKind::Value => write!(f, "value"),
            BlockKind::Loop => write!(f, "loop"),
            BlockKind::Sequence => write!(f, "sequence"),
            BlockKind::Catch => write!(f, "catch"),
        }
    }
}

/// A basic block in the CFG
#[derive(Debug, Clone)]
pub struct BasicBlock {
    pub kind: BlockKind,
    pub id: BlockId,
    pub instructions: HirVec<InstructionId>,
    pub terminal: Terminal,
    pub preds: IndexSet<BlockId>,
    pub phis: HirVec<Phi>,
}

/// Phi node for SSA
#[derive(Debug, Clone)]
pub struct Phi {
    pub place: Place,
    pub operands: IndexMap<BlockId, Place>,
}

// =============================================================================
// Terminal enum
// =============================================================================

#[derive(Debug, Clone)]
pub enum Terminal {
    Unsupported {
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Unreachable {
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Throw {
        value: Place,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Return {
        value: Place,
        return_variant: ReturnVariant,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
        effects: Option<HirVec<AliasingEffect>>,
    },
    Goto {
        block: BlockId,
        variant: GotoVariant,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    If {
        test: Place,
        consequent: BlockId,
        alternate: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Branch {
        test: Place,
        consequent: BlockId,
        alternate: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Switch {
        test: Place,
        cases: HirVec<Case>,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    DoWhile {
        loop_block: BlockId,
        test: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    While {
        test: BlockId,
        loop_block: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    For {
        init: BlockId,
        test: BlockId,
        update: Option<BlockId>,
        loop_block: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    ForOf {
        init: BlockId,
        test: BlockId,
        loop_block: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    ForIn {
        init: BlockId,
        loop_block: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Logical {
        operator: LogicalOperator,
        test: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Ternary {
        test: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Optional {
        optional: bool,
        test: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Label {
        block: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Sequence {
        block: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    MaybeThrow {
        continuation: BlockId,
        handler: Option<BlockId>,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
        effects: Option<HirVec<AliasingEffect>>,
    },
    Try {
        block: BlockId,
        handler_binding: Option<Place>,
        handler: BlockId,
        fallthrough: BlockId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    Scope {
        fallthrough: BlockId,
        block: BlockId,
        scope: ScopeId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
    PrunedScope {
        fallthrough: BlockId,
        block: BlockId,
        scope: ScopeId,
        id: EvaluationOrder,
        loc: Option<SourceLocation>,
    },
}

impl Terminal {
    /// Get the evaluation order of this terminal
    pub fn evaluation_order(&self) -> EvaluationOrder {
        match self {
            Terminal::Unsupported { id, .. }
            | Terminal::Unreachable { id, .. }
            | Terminal::Throw { id, .. }
            | Terminal::Return { id, .. }
            | Terminal::Goto { id, .. }
            | Terminal::If { id, .. }
            | Terminal::Branch { id, .. }
            | Terminal::Switch { id, .. }
            | Terminal::DoWhile { id, .. }
            | Terminal::While { id, .. }
            | Terminal::For { id, .. }
            | Terminal::ForOf { id, .. }
            | Terminal::ForIn { id, .. }
            | Terminal::Logical { id, .. }
            | Terminal::Ternary { id, .. }
            | Terminal::Optional { id, .. }
            | Terminal::Label { id, .. }
            | Terminal::Sequence { id, .. }
            | Terminal::MaybeThrow { id, .. }
            | Terminal::Try { id, .. }
            | Terminal::Scope { id, .. }
            | Terminal::PrunedScope { id, .. } => *id,
        }
    }

    /// Get the source location of this terminal
    pub fn loc(&self) -> Option<&SourceLocation> {
        match self {
            Terminal::Unsupported { loc, .. }
            | Terminal::Unreachable { loc, .. }
            | Terminal::Throw { loc, .. }
            | Terminal::Return { loc, .. }
            | Terminal::Goto { loc, .. }
            | Terminal::If { loc, .. }
            | Terminal::Branch { loc, .. }
            | Terminal::Switch { loc, .. }
            | Terminal::DoWhile { loc, .. }
            | Terminal::While { loc, .. }
            | Terminal::For { loc, .. }
            | Terminal::ForOf { loc, .. }
            | Terminal::ForIn { loc, .. }
            | Terminal::Logical { loc, .. }
            | Terminal::Ternary { loc, .. }
            | Terminal::Optional { loc, .. }
            | Terminal::Label { loc, .. }
            | Terminal::Sequence { loc, .. }
            | Terminal::MaybeThrow { loc, .. }
            | Terminal::Try { loc, .. }
            | Terminal::Scope { loc, .. }
            | Terminal::PrunedScope { loc, .. } => loc.as_ref(),
        }
    }

    /// Set the evaluation order of this terminal
    pub fn set_evaluation_order(&mut self, new_id: EvaluationOrder) {
        match self {
            Terminal::Unsupported { id, .. }
            | Terminal::Unreachable { id, .. }
            | Terminal::Throw { id, .. }
            | Terminal::Return { id, .. }
            | Terminal::Goto { id, .. }
            | Terminal::If { id, .. }
            | Terminal::Branch { id, .. }
            | Terminal::Switch { id, .. }
            | Terminal::DoWhile { id, .. }
            | Terminal::While { id, .. }
            | Terminal::For { id, .. }
            | Terminal::ForOf { id, .. }
            | Terminal::ForIn { id, .. }
            | Terminal::Logical { id, .. }
            | Terminal::Ternary { id, .. }
            | Terminal::Optional { id, .. }
            | Terminal::Label { id, .. }
            | Terminal::Sequence { id, .. }
            | Terminal::MaybeThrow { id, .. }
            | Terminal::Try { id, .. }
            | Terminal::Scope { id, .. }
            | Terminal::PrunedScope { id, .. } => *id = new_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReturnVariant {
    Void,
    Implicit,
    Explicit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GotoVariant {
    Break,
    Continue,
    Try,
}

#[derive(Debug, Clone)]
pub struct Case {
    pub test: Option<Place>,
    pub block: BlockId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogicalOperator {
    And,
    Or,
    NullishCoalescing,
}

impl std::fmt::Display for LogicalOperator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogicalOperator::And => write!(f, "&&"),
            LogicalOperator::Or => write!(f, "||"),
            LogicalOperator::NullishCoalescing => write!(f, "??"),
        }
    }
}

// =============================================================================
// Instruction types
// =============================================================================

#[derive(Debug, Clone)]
pub struct Instruction {
    pub id: EvaluationOrder,
    pub lvalue: Place,
    pub value: InstructionValue,
    pub loc: Option<SourceLocation>,
    pub effects: Option<HirVec<AliasingEffect>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstructionKind {
    Const,
    Let,
    Reassign,
    Catch,
    HoistedConst,
    HoistedLet,
    HoistedFunction,
    Function,
}

#[derive(Debug, Clone)]
pub struct LValue {
    pub place: Place,
    pub kind: InstructionKind,
}

#[derive(Debug, Clone)]
pub struct LValuePattern {
    pub pattern: Pattern,
    pub kind: InstructionKind,
}

#[derive(Debug, Clone)]
pub enum Pattern {
    Array(ArrayPattern),
    Object(ObjectPattern),
}

// =============================================================================
// InstructionValue enum
// =============================================================================

#[derive(Debug, Clone)]
pub enum InstructionValue {
    LoadLocal {
        place: Place,
        loc: Option<SourceLocation>,
    },
    LoadContext {
        place: Place,
        loc: Option<SourceLocation>,
    },
    DeclareLocal {
        lvalue: LValue,
        type_annotation: Option<StoreStr>,
        loc: Option<SourceLocation>,
    },
    DeclareContext {
        lvalue: LValue,
        loc: Option<SourceLocation>,
    },
    StoreLocal {
        lvalue: LValue,
        value: Place,
        type_annotation: Option<StoreStr>,
        loc: Option<SourceLocation>,
    },
    StoreContext {
        lvalue: LValue,
        value: Place,
        loc: Option<SourceLocation>,
    },
    Destructure {
        lvalue: LValuePattern,
        value: Place,
        loc: Option<SourceLocation>,
    },
    Primitive {
        value: PrimitiveValue,
        loc: Option<SourceLocation>,
    },
    JSXText {
        value: StoreStr,
        loc: Option<SourceLocation>,
    },
    BinaryExpression {
        operator: BinaryOperator,
        left: Place,
        right: Place,
        loc: Option<SourceLocation>,
    },
    NewExpression {
        callee: Place,
        args: HirVec<PlaceOrSpread>,
        loc: Option<SourceLocation>,
    },
    CallExpression {
        callee: Place,
        args: HirVec<PlaceOrSpread>,
        loc: Option<SourceLocation>,
    },
    MethodCall {
        receiver: Place,
        property: Place,
        args: HirVec<PlaceOrSpread>,
        loc: Option<SourceLocation>,
    },
    UnaryExpression {
        operator: UnaryOperator,
        value: Place,
        loc: Option<SourceLocation>,
    },
    TypeCastExpression {
        value: Place,
        type_: Type,
        type_annotation_name: Option<StoreStr>,
        type_annotation_kind: Option<&'static str>,
        /// The original AST type annotation node, preserved for codegen.
        /// For Flow: the inner type from TypeAnnotation.typeAnnotation
        /// For TS: the TSType node from TSAsExpression/TSSatisfiesExpression
        type_annotation: Option<StoreStr>,
        loc: Option<SourceLocation>,
    },
    JsxExpression {
        tag: JsxTag,
        props: HirVec<JsxAttribute>,
        children: Option<HirVec<Place>>,
        loc: Option<SourceLocation>,
        opening_loc: Option<SourceLocation>,
        closing_loc: Option<SourceLocation>,
    },
    ObjectExpression {
        properties: HirVec<ObjectPropertyOrSpread>,
        loc: Option<SourceLocation>,
    },
    ObjectMethod {
        loc: Option<SourceLocation>,
        lowered_func: LoweredFunction,
    },
    ArrayExpression {
        elements: HirVec<ArrayElement>,
        loc: Option<SourceLocation>,
    },
    JsxFragment {
        children: HirVec<Place>,
        loc: Option<SourceLocation>,
    },
    RegExpLiteral {
        pattern: StoreStr,
        flags: StoreStr,
        loc: Option<SourceLocation>,
    },
    MetaProperty {
        meta: &'static str,
        property: &'static str,
        loc: Option<SourceLocation>,
    },
    PropertyStore {
        object: Place,
        property: PropertyLiteral,
        value: Place,
        loc: Option<SourceLocation>,
    },
    PropertyLoad {
        object: Place,
        property: PropertyLiteral,
        loc: Option<SourceLocation>,
    },
    PropertyDelete {
        object: Place,
        property: PropertyLiteral,
        loc: Option<SourceLocation>,
    },
    ComputedStore {
        object: Place,
        property: Place,
        value: Place,
        loc: Option<SourceLocation>,
    },
    ComputedLoad {
        object: Place,
        property: Place,
        loc: Option<SourceLocation>,
    },
    ComputedDelete {
        object: Place,
        property: Place,
        loc: Option<SourceLocation>,
    },
    LoadGlobal {
        binding: NonLocalBinding,
        loc: Option<SourceLocation>,
    },
    StoreGlobal {
        name: StoreStr,
        /// The original Bun symbol being assigned to. `Ref::NONE` if synthetic.
        ref_: bun_ast::Ref,
        value: Place,
        loc: Option<SourceLocation>,
    },
    FunctionExpression {
        name: Option<StoreStr>,
        name_hint: Option<StoreStr>,
        lowered_func: LoweredFunction,
        expr_type: FunctionExpressionType,
        loc: Option<SourceLocation>,
    },
    TaggedTemplateExpression {
        tag: Place,
        value: TemplateQuasi,
        loc: Option<SourceLocation>,
    },
    TemplateLiteral {
        subexprs: HirVec<Place>,
        quasis: HirVec<TemplateQuasi>,
        loc: Option<SourceLocation>,
    },
    Await {
        value: Place,
        loc: Option<SourceLocation>,
    },
    GetIterator {
        collection: Place,
        loc: Option<SourceLocation>,
    },
    IteratorNext {
        iterator: Place,
        collection: Place,
        loc: Option<SourceLocation>,
    },
    NextPropertyOf {
        value: Place,
        loc: Option<SourceLocation>,
    },
    PrefixUpdate {
        lvalue: Place,
        operation: UpdateOperator,
        value: Place,
        loc: Option<SourceLocation>,
    },
    PostfixUpdate {
        lvalue: Place,
        operation: UpdateOperator,
        value: Place,
        loc: Option<SourceLocation>,
    },
    Debugger {
        loc: Option<SourceLocation>,
    },
    StartMemoize {
        manual_memo_id: u32,
        deps: Option<HirVec<ManualMemoDependency>>,
        deps_loc: Option<Option<SourceLocation>>,
        has_invalid_deps: bool,
        loc: Option<SourceLocation>,
    },
    FinishMemoize {
        manual_memo_id: u32,
        decl: Place,
        pruned: bool,
        loc: Option<SourceLocation>,
    },
    UnsupportedNode {
        node_type: Option<&'static str>,
        /// The original AST node serialized as JSON, so codegen can emit it verbatim.
        original_node: Option<StoreStr>,
        loc: Option<SourceLocation>,
    },
}

impl InstructionValue {
    pub fn loc(&self) -> Option<&SourceLocation> {
        match self {
            InstructionValue::LoadLocal { loc, .. }
            | InstructionValue::LoadContext { loc, .. }
            | InstructionValue::DeclareLocal { loc, .. }
            | InstructionValue::DeclareContext { loc, .. }
            | InstructionValue::StoreLocal { loc, .. }
            | InstructionValue::StoreContext { loc, .. }
            | InstructionValue::Destructure { loc, .. }
            | InstructionValue::Primitive { loc, .. }
            | InstructionValue::JSXText { loc, .. }
            | InstructionValue::BinaryExpression { loc, .. }
            | InstructionValue::NewExpression { loc, .. }
            | InstructionValue::CallExpression { loc, .. }
            | InstructionValue::MethodCall { loc, .. }
            | InstructionValue::UnaryExpression { loc, .. }
            | InstructionValue::TypeCastExpression { loc, .. }
            | InstructionValue::JsxExpression { loc, .. }
            | InstructionValue::ObjectExpression { loc, .. }
            | InstructionValue::ObjectMethod { loc, .. }
            | InstructionValue::ArrayExpression { loc, .. }
            | InstructionValue::JsxFragment { loc, .. }
            | InstructionValue::RegExpLiteral { loc, .. }
            | InstructionValue::MetaProperty { loc, .. }
            | InstructionValue::PropertyStore { loc, .. }
            | InstructionValue::PropertyLoad { loc, .. }
            | InstructionValue::PropertyDelete { loc, .. }
            | InstructionValue::ComputedStore { loc, .. }
            | InstructionValue::ComputedLoad { loc, .. }
            | InstructionValue::ComputedDelete { loc, .. }
            | InstructionValue::LoadGlobal { loc, .. }
            | InstructionValue::StoreGlobal { loc, .. }
            | InstructionValue::FunctionExpression { loc, .. }
            | InstructionValue::TaggedTemplateExpression { loc, .. }
            | InstructionValue::TemplateLiteral { loc, .. }
            | InstructionValue::Await { loc, .. }
            | InstructionValue::GetIterator { loc, .. }
            | InstructionValue::IteratorNext { loc, .. }
            | InstructionValue::NextPropertyOf { loc, .. }
            | InstructionValue::PrefixUpdate { loc, .. }
            | InstructionValue::PostfixUpdate { loc, .. }
            | InstructionValue::Debugger { loc, .. }
            | InstructionValue::StartMemoize { loc, .. }
            | InstructionValue::FinishMemoize { loc, .. }
            | InstructionValue::UnsupportedNode { loc, .. } => loc.as_ref(),
        }
    }
}

// =============================================================================
// Supporting types
// =============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PrimitiveValue {
    Null,
    Undefined,
    Boolean(bool),
    Number(FloatValue),
    String(crate::diagnostics::JsString),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOperator {
    Equal,
    NotEqual,
    StrictEqual,
    StrictNotEqual,
    LessThan,
    LessEqual,
    GreaterThan,
    GreaterEqual,
    ShiftLeft,
    ShiftRight,
    UnsignedShiftRight,
    Add,
    Subtract,
    Multiply,
    Divide,
    Modulo,
    Exponent,
    BitwiseOr,
    BitwiseXor,
    BitwiseAnd,
    In,
    InstanceOf,
}

impl std::fmt::Display for BinaryOperator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BinaryOperator::Equal => write!(f, "=="),
            BinaryOperator::NotEqual => write!(f, "!="),
            BinaryOperator::StrictEqual => write!(f, "==="),
            BinaryOperator::StrictNotEqual => write!(f, "!=="),
            BinaryOperator::LessThan => write!(f, "<"),
            BinaryOperator::LessEqual => write!(f, "<="),
            BinaryOperator::GreaterThan => write!(f, ">"),
            BinaryOperator::GreaterEqual => write!(f, ">="),
            BinaryOperator::ShiftLeft => write!(f, "<<"),
            BinaryOperator::ShiftRight => write!(f, ">>"),
            BinaryOperator::UnsignedShiftRight => write!(f, ">>>"),
            BinaryOperator::Add => write!(f, "+"),
            BinaryOperator::Subtract => write!(f, "-"),
            BinaryOperator::Multiply => write!(f, "*"),
            BinaryOperator::Divide => write!(f, "/"),
            BinaryOperator::Modulo => write!(f, "%"),
            BinaryOperator::Exponent => write!(f, "**"),
            BinaryOperator::BitwiseOr => write!(f, "|"),
            BinaryOperator::BitwiseXor => write!(f, "^"),
            BinaryOperator::BitwiseAnd => write!(f, "&"),
            BinaryOperator::In => write!(f, "in"),
            BinaryOperator::InstanceOf => write!(f, "instanceof"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOperator {
    Minus,
    Plus,
    Not,
    BitwiseNot,
    TypeOf,
    Void,
}

impl std::fmt::Display for UnaryOperator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnaryOperator::Minus => write!(f, "-"),
            UnaryOperator::Plus => write!(f, "+"),
            UnaryOperator::Not => write!(f, "!"),
            UnaryOperator::BitwiseNot => write!(f, "~"),
            UnaryOperator::TypeOf => write!(f, "typeof"),
            UnaryOperator::Void => write!(f, "void"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateOperator {
    Increment,
    Decrement,
}

impl std::fmt::Display for UpdateOperator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateOperator::Increment => write!(f, "++"),
            UpdateOperator::Decrement => write!(f, "--"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FunctionExpressionType {
    ArrowFunctionExpression,
    FunctionExpression,
    FunctionDeclaration,
}

#[derive(Debug, Clone)]
pub struct TemplateQuasi {
    pub raw: StoreStr,
    pub cooked: Option<StoreStr>,
}

#[derive(Debug, Clone)]
pub struct ManualMemoDependency {
    pub root: ManualMemoDependencyRoot,
    pub path: HirVec<DependencyPathEntry>,
    pub loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
pub enum ManualMemoDependencyRoot {
    NamedLocal { value: Place, constant: bool },
    Global { identifier_name: StoreStr },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DependencyPathEntry {
    pub property: PropertyLiteral,
    pub optional: bool,
    pub loc: Option<SourceLocation>,
}

// =============================================================================
// Place, Identifier, and related types
// =============================================================================

#[derive(Debug, Clone)]
pub struct Place {
    pub identifier: IdentifierId,
    pub effect: Effect,
    pub reactive: bool,
    pub loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
pub struct Identifier {
    pub id: IdentifierId,
    pub declaration_id: DeclarationId,
    pub name: Option<IdentifierName>,
    pub mutable_range: MutableRange,
    pub scope: Option<ScopeId>,
    pub type_: TypeId,
    pub loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
pub struct MutableRange {
    /// Unique identity for this logical range. Cloning preserves the ID
    /// (same logical range); use `Environment::new_mutable_range()` to create
    /// a range with a fresh ID.
    pub id: MutableRangeId,
    pub start: EvaluationOrder,
    pub end: EvaluationOrder,
}

impl MutableRange {
    /// Returns true if the given evaluation order falls within this mutable range.
    /// Corresponds to TS `inRange({id}, range)` / `isMutable(instr, place)`.
    pub fn contains(&self, eval_order: EvaluationOrder) -> bool {
        eval_order >= self.start && eval_order < self.end
    }

    /// Returns true if this range has the same identity as `other`.
    /// In the TS compiler, this corresponds to checking whether two mutableRange
    /// references point to the same JS object (=== identity).
    pub fn same_range(&self, other: &MutableRange) -> bool {
        self.id == other.id
    }
}

#[derive(Debug, Clone)]
pub enum IdentifierName {
    Named(StoreStr),
    Promoted(StoreStr),
}

impl IdentifierName {
    pub fn value(&self) -> &[u8] {
        match self {
            IdentifierName::Named(v) | IdentifierName::Promoted(v) => v.slice(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    Unknown,
    Freeze,
    Read,
    Capture,
    ConditionallyMutateIterator,
    ConditionallyMutate,
    Mutate,
    Store,
}

impl Effect {
    /// Returns true if this effect represents a mutable operation.
    /// Mutable effects are: Capture, Store, ConditionallyMutate,
    /// ConditionallyMutateIterator, and Mutate.
    pub fn is_mutable(&self) -> bool {
        matches!(
            self,
            Effect::Capture
                | Effect::Store
                | Effect::ConditionallyMutate
                | Effect::ConditionallyMutateIterator
                | Effect::Mutate
        )
    }
}

impl std::fmt::Display for Effect {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Effect::Unknown => write!(f, "<unknown>"),
            Effect::Freeze => write!(f, "freeze"),
            Effect::Read => write!(f, "read"),
            Effect::Capture => write!(f, "capture"),
            Effect::ConditionallyMutateIterator => write!(f, "mutate-iterator?"),
            Effect::ConditionallyMutate => write!(f, "mutate?"),
            Effect::Mutate => write!(f, "mutate"),
            Effect::Store => write!(f, "store"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct SpreadPattern {
    pub place: Place,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hole {
    Hole,
}

#[derive(Debug, Clone)]
pub struct ArrayPattern {
    pub items: HirVec<ArrayPatternElement>,
    pub loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
pub enum ArrayPatternElement {
    Place(Place),
    Spread(SpreadPattern),
    Hole,
}

#[derive(Debug, Clone)]
pub struct ObjectPattern {
    pub properties: HirVec<ObjectPropertyOrSpread>,
    pub loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
pub enum ObjectPropertyOrSpread {
    Property(ObjectProperty),
    Spread(SpreadPattern),
}

#[derive(Debug, Clone)]
pub struct ObjectProperty {
    pub key: ObjectPropertyKey,
    pub property_type: ObjectPropertyType,
    pub place: Place,
}

#[derive(Debug, Clone)]
pub enum ObjectPropertyKey {
    String { name: StoreStr },
    Identifier { name: StoreStr },
    Computed { name: Place },
    Number { name: FloatValue },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectPropertyType {
    Property,
    Method,
}

impl std::fmt::Display for ObjectPropertyType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ObjectPropertyType::Property => write!(f, "property"),
            ObjectPropertyType::Method => write!(f, "method"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PropertyLiteral {
    String(StoreStr),
    Number(FloatValue),
}

impl std::fmt::Display for PropertyLiteral {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PropertyLiteral::String(s) => write!(f, "{}", bun_core::BStr::new(s.slice())),
            PropertyLiteral::Number(n) => write!(f, "{}", n),
        }
    }
}

#[derive(Debug, Clone)]
pub enum PlaceOrSpread {
    Place(Place),
    Spread(SpreadPattern),
}

#[derive(Debug, Clone)]
pub enum ArrayElement {
    Place(Place),
    Spread(SpreadPattern),
    Hole,
}

#[derive(Debug, Clone)]
pub struct LoweredFunction {
    pub func: FunctionId,
}

#[derive(Debug, Clone)]
pub struct BuiltinTag {
    pub name: StoreStr,
    pub loc: Option<SourceLocation>,
}

#[derive(Debug, Clone)]
pub enum JsxTag {
    Place(Place),
    Builtin(BuiltinTag),
}

#[derive(Debug, Clone)]
pub enum JsxAttribute {
    SpreadAttribute { argument: Place },
    Attribute { name: StoreStr, place: Place },
}

// =============================================================================
// Variable Binding types
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BindingKind {
    Var,
    Let,
    Const,
    Param,
    Module,
    Hoisted,
    Local,
    Unknown,
}

#[derive(Debug, Clone)]
pub enum VariableBinding {
    Identifier {
        identifier: IdentifierId,
        binding_kind: BindingKind,
    },
    Global {
        name: StoreStr,
    },
    ImportDefault {
        name: StoreStr,
        module: StoreStr,
    },
    ImportSpecifier {
        name: StoreStr,
        module: StoreStr,
        imported: StoreStr,
    },
    ImportNamespace {
        name: StoreStr,
        module: StoreStr,
    },
    ModuleLocal {
        name: StoreStr,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct NonLocalBinding {
    /// The original Bun symbol this reference resolves to. `Ref::NONE` for
    /// synthetic globals (e.g. `undefined` constructed during lowering with no
    /// source identifier).
    pub ref_: bun_ast::Ref,
    pub kind: NonLocalKind,
}

#[derive(Clone, Copy)]
pub enum NonLocalKind {
    ImportDefault {
        name: StoreStr,
        module: StoreStr,
    },
    ImportSpecifier {
        name: StoreStr,
        module: StoreStr,
        imported: StoreStr,
    },
    ImportNamespace {
        name: StoreStr,
        module: StoreStr,
    },
    ModuleLocal {
        name: StoreStr,
    },
    Global {
        name: StoreStr,
    },
    /// A Bun-synthetic value expression the compiler treats as an opaque frozen
    /// constant. The original `Expr` is carried whole so codegen emits it
    /// unchanged and the bundler keeps any `import_record_index` / `Ref` /
    /// variant tag it holds.
    BunOpaque(bun_ast::Expr),
}

impl std::fmt::Debug for NonLocalKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ImportDefault { name, module } => f
                .debug_struct("ImportDefault")
                .field("name", name)
                .field("module", module)
                .finish(),
            Self::ImportSpecifier {
                name,
                module,
                imported,
            } => f
                .debug_struct("ImportSpecifier")
                .field("name", name)
                .field("module", module)
                .field("imported", imported)
                .finish(),
            Self::ImportNamespace { name, module } => f
                .debug_struct("ImportNamespace")
                .field("name", name)
                .field("module", module)
                .finish(),
            Self::ModuleLocal { name } => {
                f.debug_struct("ModuleLocal").field("name", name).finish()
            }
            Self::Global { name } => f.debug_struct("Global").field("name", name).finish(),
            Self::BunOpaque(e) => f.debug_tuple("BunOpaque").field(&e.data.tag()).finish(),
        }
    }
}

impl NonLocalBinding {
    /// Returns the `name` field common to all variants.
    pub fn name(&self) -> &[u8] {
        match &self.kind {
            NonLocalKind::ImportDefault { name, .. }
            | NonLocalKind::ImportSpecifier { name, .. }
            | NonLocalKind::ImportNamespace { name, .. }
            | NonLocalKind::ModuleLocal { name, .. }
            | NonLocalKind::Global { name, .. } => name.slice(),
            NonLocalKind::BunOpaque(e) => {
                use bun_ast::expr::Tag;
                match e.data.tag() {
                    Tag::ERequireString | Tag::ERequireCallTarget => b"require",
                    Tag::ERequireResolveString | Tag::ERequireResolveCallTarget => {
                        b"require.resolve"
                    }
                    Tag::ERequireMain => b"require.main",
                    Tag::EImportMetaMain => b"import.meta.main",
                    Tag::EBranchBoolean => b"feature()",
                    Tag::ESpecial => b"module.exports",
                    _ => b"<bun-opaque>",
                }
            }
        }
    }

    /// Returns the original Bun `Ref` this binding came from, or `None` if it
    /// was synthesized during lowering without a source identifier.
    pub fn ref_(&self) -> Option<bun_ast::Ref> {
        if self.ref_.is_valid() {
            Some(self.ref_)
        } else {
            None
        }
    }
}

// =============================================================================
// Type system (from Types.ts)
// =============================================================================

/// The recursive `Box<Type>` fields here intentionally use the global
/// allocator, NOT [`HirBox`]: `Type` values are constructed and held by the
/// process-lifetime [`ShapeRegistry`](crate::hir::object_shape::ShapeRegistry),
/// which outlives the per-file AST arena, so an arena-backed box would dangle
/// after `Store::reset()`. The leak hazard described on [`HirVec`] does not
/// apply because `Type` is stored in `Drop`-running containers (registry
/// `HashMap`s, the unifier's substitution map) rather than bulk-freed arena
/// slabs; the one arena-backed holder, `Phi::operands`, is dropped normally
/// at the end of type inference before any arena reset.
#[derive(Debug, Clone)]
pub enum Type {
    Primitive,
    Function {
        shape_id: Option<&'static str>,
        return_type: Box<Type>,
        is_constructor: bool,
    },
    Object {
        shape_id: Option<&'static str>,
    },
    TypeVar {
        id: TypeId,
    },
    Poly,
    Phi {
        operands: HirVec<Type>,
    },
    Property {
        object_type: Box<Type>,
        object_name: StoreStr,
        property_name: PropertyNameKind,
    },
    ObjectMethod,
}

#[derive(Debug, Clone)]
pub enum PropertyNameKind {
    Literal { value: PropertyLiteral },
    Computed { value: Box<Type> },
}

// =============================================================================
// ReactiveScope
// =============================================================================

#[derive(Debug, Clone)]
pub struct ReactiveScope {
    pub id: ScopeId,
    pub range: MutableRange,

    /// The inputs to this reactive scope (populated by later passes)
    pub dependencies: HirVec<ReactiveScopeDependency>,

    /// The set of values produced by this scope (populated by later passes)
    pub declarations: HirVec<(IdentifierId, ReactiveScopeDeclaration)>,

    /// Identifiers which are reassigned by this scope (populated by later passes)
    pub reassignments: HirVec<IdentifierId>,

    /// If the scope contains an early return, this stores info about it (populated by later passes)
    pub early_return_value: Option<ReactiveScopeEarlyReturn>,

    /// Scopes that were merged into this one (populated by later passes)
    pub merged: HirVec<ScopeId>,

    /// Source location spanning the scope
    pub loc: Option<SourceLocation>,
}

/// A dependency of a reactive scope.
#[derive(Debug, Clone)]
pub struct ReactiveScopeDependency {
    pub identifier: IdentifierId,
    pub reactive: bool,
    pub path: HirVec<DependencyPathEntry>,
    pub loc: Option<SourceLocation>,
}

/// A declaration produced by a reactive scope.
#[derive(Debug, Clone)]
pub struct ReactiveScopeDeclaration {
    pub identifier: IdentifierId,
    pub scope: ScopeId,
}

/// Early return value info for a reactive scope.
#[derive(Debug, Clone)]
pub struct ReactiveScopeEarlyReturn {
    pub value: IdentifierId,
    pub loc: Option<SourceLocation>,
    pub label: BlockId,
}

// =============================================================================
// Aliasing effects (runtime types, from AliasingEffects.ts)
// =============================================================================

use crate::hir::object_shape::FunctionSignature;
use crate::hir::type_config::ValueKind;
use crate::hir::type_config::ValueReason;

/// Reason for a mutation, used for generating hints (e.g. rename to "Ref").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MutationReason {
    AssignCurrentProperty,
}

/// Describes the aliasing/mutation/data-flow effects of an instruction or terminal.
/// Ported from TS `AliasingEffect` in `AliasingEffects.ts`.
#[derive(Debug, Clone)]
pub enum AliasingEffect {
    /// Marks the given value and its direct aliases as frozen.
    Freeze { value: Place, reason: ValueReason },
    /// Mutate the value and any direct aliases.
    Mutate {
        value: Place,
        reason: Option<MutationReason>,
    },
    /// Mutate the value conditionally (only if mutable).
    MutateConditionally { value: Place },
    /// Mutate the value and transitive captures.
    MutateTransitive { value: Place },
    /// Mutate the value and transitive captures conditionally.
    MutateTransitiveConditionally { value: Place },
    /// Information flow from `from` to `into` (non-aliasing capture).
    Capture { from: Place, into: Place },
    /// Direct aliasing: mutation of `into` implies mutation of `from`.
    Alias { from: Place, into: Place },
    /// Potential aliasing relationship.
    MaybeAlias { from: Place, into: Place },
    /// Direct assignment: `into = from`.
    Assign { from: Place, into: Place },
    /// Creates a value of the given kind at the given place.
    Create {
        into: Place,
        value: ValueKind,
        reason: ValueReason,
    },
    /// Creates a new value with the same kind as the source.
    CreateFrom { from: Place, into: Place },
    /// Immutable data flow (escape analysis only, no mutable range influence).
    ImmutableCapture { from: Place, into: Place },
    /// Function call application.
    Apply {
        receiver: Place,
        function: Place,
        mutates_function: bool,
        args: HirVec<PlaceOrSpreadOrHole>,
        into: Place,
        signature: Option<FunctionSignature>,
        loc: Option<SourceLocation>,
    },
    /// Function expression creation with captures.
    CreateFunction {
        captures: HirVec<Place>,
        function_id: FunctionId,
        into: Place,
    },
    /// Mutation of a value known to be frozen (error).
    MutateFrozen {
        place: Place,
        error: CompilerDiagnostic,
    },
    /// Mutation of a global value (error).
    MutateGlobal {
        place: Place,
        error: CompilerDiagnostic,
    },
    /// Side-effect not safe during render.
    Impure {
        place: Place,
        error: CompilerDiagnostic,
    },
    /// Value is accessed during render.
    Render { place: Place },
}

/// Combined Place/Spread/Hole for Apply args.
#[derive(Debug, Clone)]
pub enum PlaceOrSpreadOrHole {
    Place(Place),
    Spread(SpreadPattern),
    Hole,
}

/// Aliasing signature for function calls.
/// Ported from TS `AliasingSignature` in `AliasingEffects.ts`.
#[derive(Debug, Clone)]
pub struct AliasingSignature {
    pub receiver: IdentifierId,
    pub params: HirVec<IdentifierId>,
    pub rest: Option<IdentifierId>,
    pub returns: IdentifierId,
    pub effects: HirVec<AliasingEffect>,
    pub temporaries: HirVec<Place>,
}

// =============================================================================
// Type helper functions (ported from HIR.ts)
// =============================================================================

use crate::hir::object_shape::BUILT_IN_ARRAY_ID;
use crate::hir::object_shape::BUILT_IN_JSX_ID;
use crate::hir::object_shape::BUILT_IN_MAP_ID;
use crate::hir::object_shape::BUILT_IN_PROPS_ID;
use crate::hir::object_shape::BUILT_IN_REF_VALUE_ID;
use crate::hir::object_shape::BUILT_IN_SET_ID;
use crate::hir::object_shape::BUILT_IN_USE_OPERATOR_ID;
use crate::hir::object_shape::BUILT_IN_USE_REF_ID;

/// Returns true if the type (looked up via identifier) is primitive.
pub fn is_primitive_type(ty: &Type) -> bool {
    matches!(ty, Type::Primitive)
}

/// Returns true if the type is the props object.
pub fn is_props_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_PROPS_ID)
}

/// Returns true if the type is an array.
pub fn is_array_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_ARRAY_ID)
}

/// Returns true if the type is a Set.
pub fn is_set_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_SET_ID)
}

/// Returns true if the type is a Map.
pub fn is_map_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_MAP_ID)
}

/// Returns true if the type is JSX.
pub fn is_jsx_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_JSX_ID)
}

/// Returns true if the identifier type is a ref value.
pub fn is_ref_value_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_REF_VALUE_ID)
}

/// Returns true if the identifier type is useRef.
pub fn is_use_ref_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == BUILT_IN_USE_REF_ID)
}

/// Returns true if the type is a ref or ref value.
pub fn is_ref_or_ref_value(ty: &Type) -> bool {
    is_use_ref_type(ty) || is_ref_value_type(ty)
}

/// Returns true if the type is a useState result (BuiltInUseState).
pub fn is_use_state_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == object_shape::BUILT_IN_USE_STATE_ID)
}

/// Returns true if the type is a setState function (BuiltInSetState).
pub fn is_set_state_type(ty: &Type) -> bool {
    matches!(ty, Type::Function { shape_id: Some(id), .. } if *id == object_shape::BUILT_IN_SET_STATE_ID)
}

/// Returns true if the type is a useEffect hook.
pub fn is_use_effect_hook_type(ty: &Type) -> bool {
    matches!(ty, Type::Function { shape_id: Some(id), .. } if *id == object_shape::BUILT_IN_USE_EFFECT_HOOK_ID)
}

/// Returns true if the type is a useLayoutEffect hook.
pub fn is_use_layout_effect_hook_type(ty: &Type) -> bool {
    matches!(ty, Type::Function { shape_id: Some(id), .. } if *id == object_shape::BUILT_IN_USE_LAYOUT_EFFECT_HOOK_ID)
}

/// Returns true if the type is a useInsertionEffect hook.
pub fn is_use_insertion_effect_hook_type(ty: &Type) -> bool {
    matches!(ty, Type::Function { shape_id: Some(id), .. } if *id == object_shape::BUILT_IN_USE_INSERTION_EFFECT_HOOK_ID)
}

/// Returns true if the type is a useEffectEvent function.
pub fn is_use_effect_event_type(ty: &Type) -> bool {
    matches!(ty, Type::Function { shape_id: Some(id), .. } if *id == object_shape::BUILT_IN_USE_EFFECT_EVENT_ID)
}

/// Returns true if the type is a ref or ref-like mutable type (e.g. Reanimated shared values).
pub fn is_ref_or_ref_like_mutable_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) }
        if *id == object_shape::BUILT_IN_USE_REF_ID || *id == object_shape::REANIMATED_SHARED_VALUE_ID)
}

/// Returns true if the type is the `use()` operator (React.use).
pub fn is_use_operator_type(ty: &Type) -> bool {
    matches!(
        ty,
        Type::Function { shape_id: Some(id), .. }
            if *id == BUILT_IN_USE_OPERATOR_ID
    )
}

/// Returns true if the type is a plain object (BuiltInObject).
pub fn is_plain_object_type(ty: &Type) -> bool {
    matches!(ty, Type::Object { shape_id: Some(id) } if *id == object_shape::BUILT_IN_OBJECT_ID)
}

/// Returns true if the type is a startTransition function (BuiltInStartTransition).
pub fn is_start_transition_type(ty: &Type) -> bool {
    matches!(ty, Type::Function { shape_id: Some(id), .. } if *id == object_shape::BUILT_IN_START_TRANSITION_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_js_number() {
        // Scientific notation for large numbers (>= 1e21)
        assert_eq!(format_js_number(1e21), "1e+21");
        assert_eq!(format_js_number(1.5e21), "1.5e+21");
        assert_eq!(
            format_js_number(2.18739127891275e22),
            "2.18739127891275e+22"
        );
        assert_eq!(format_js_number(1e100), "1e+100");
        assert_eq!(format_js_number(-1e21), "-1e+21");
        assert_eq!(format_js_number(-1e100), "-1e+100");

        // Scientific notation for small numbers (< 1e-6)
        assert_eq!(format_js_number(1e-7), "1e-7");
        assert_eq!(format_js_number(5e-7), "5e-7");
        assert_eq!(format_js_number(1.5e-8), "1.5e-8");
        assert_eq!(format_js_number(-1.5e-8), "-1.5e-8");

        // Non-scientific large numbers (< 1e21)
        assert_eq!(format_js_number(1e20), "100000000000000000000");
        assert_eq!(format_js_number(1e-6), "0.000001");

        // Integers
        assert_eq!(format_js_number(0.0), "0");
        assert_eq!(format_js_number(-0.0), "0");
        assert_eq!(format_js_number(1.0), "1");
        assert_eq!(format_js_number(100.0), "100");

        // Regular floats
        assert_eq!(format_js_number(1.5), "1.5");
        assert_eq!(format_js_number(0.5), "0.5");
        assert_eq!(format_js_number(0.1), "0.1");

        // Special values
        assert_eq!(format_js_number(f64::NAN), "NaN");
        assert_eq!(format_js_number(f64::INFINITY), "Infinity");
        assert_eq!(format_js_number(f64::NEG_INFINITY), "-Infinity");
    }
}

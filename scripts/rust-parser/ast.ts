// AST node types for the Rust parser. Every node has a `kind` discriminant and
// a half-open `[start, end)` span of UTF-16 offsets into the source. Spans of
// items, statements, and expressions exclude their outer attributes; each
// attribute carries its own span.
//
// The shape follows syn closely, so its documentation is a usable guide:
// items, generics, types, patterns, expressions, statements, attributes, and
// token trees for the parts Rust itself leaves unparsed (macro input,
// `macro_rules!` bodies).

import type { TokenTree } from "./lexer.ts";
export type { Comment, TokenGroup, TokenLeaf, TokenTree } from "./lexer.ts";

export interface Span {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Attributes

export interface Attribute extends Span {
  kind: "Attribute";
  style: "outer" | "inner";
  path: Path;
  /** `path` as a string: `allow`, `cfg_attr`, `rustfmt::skip`, `unsafe`. */
  name: string;
  /** Delimiter of the argument list, or null for `#[name]` and `#[name = value]`. */
  delim: "(" | "[" | "{" | null;
  /** Token trees inside the delimiter, or null. */
  tokens: TokenTree[] | null;
  /** The expression after `=` in `#[name = value]`, or null. */
  value: Expr | null;
  /**
   * Structured view of the attribute: `#[allow(dead_code)]` is a `MetaList`
   * named `allow` with one `MetaPath` item, `#[doc = "x"]` a `MetaNameValue`,
   * `#[test]` a `MetaPath`. Token runs that do not fit the meta grammar become
   * `MetaTokens` items.
   */
  meta: Meta;
}

export type Meta = MetaPath | MetaList | MetaNameValue | MetaTokens;

export interface MetaPath {
  kind: "MetaPath";
  path: string;
}

export interface MetaList {
  kind: "MetaList";
  path: string;
  items: Meta[];
}

export interface MetaNameValue {
  kind: "MetaNameValue";
  path: string;
  /** Source text of the value, e.g. `"linux"` (quotes included). */
  value: string;
  /** The value parsed as an expression, when that succeeds. */
  expr: Expr | null;
}

export interface MetaTokens {
  kind: "MetaTokens";
  tokens: TokenTree[];
}

// ---------------------------------------------------------------------------
// Paths

export interface Path extends Span {
  kind: "Path";
  /** Leading `::`. */
  global: boolean;
  /** The `T` in `<T as Trait>::x` or `<T>::x`. */
  qself: Type | null;
  /** The `Trait` in `<T as Trait>::x`. */
  asTrait: Path | null;
  segments: PathSegment[];
}

export interface PathSegment extends Span {
  kind: "PathSegment";
  /** Identifier as written (`self`, `Self`, `crate`, `super`, `r#type` included). */
  name: string;
  args: AngleArgs | ParenArgs | null;
}

export interface AngleArgs extends Span {
  kind: "AngleArgs";
  /** Written with a leading `::` (turbofish). */
  turbofish: boolean;
  args: GenericArg[];
}

/** `Fn(A, B) -> C` style arguments. */
export interface ParenArgs extends Span {
  kind: "ParenArgs";
  inputs: Type[];
  output: Type | null;
}

export type GenericArg = Type | Lifetime | ConstArg | AssocBinding | AssocConstraint;

export interface Lifetime extends Span {
  kind: "Lifetime";
  /** Including the quote: `'a`, `'static`, `'_`. */
  name: string;
}

/** A const generic argument: a literal, `-literal`, or `{ block }`. */
export interface ConstArg extends Span {
  kind: "ConstArg";
  expr: Expr;
}

/** `Item = Type`, or `N = 3` (associated const equality, `value` set and `ty` null). */
export interface AssocBinding extends Span {
  kind: "AssocBinding";
  name: string;
  args: AngleArgs | null;
  ty: Type | null;
  value: Expr | null;
}

/** `Item: Bound + Bound` */
export interface AssocConstraint extends Span {
  kind: "AssocConstraint";
  name: string;
  args: AngleArgs | null;
  bounds: Bound[];
}

// ---------------------------------------------------------------------------
// Generics and bounds

/**
 * Generic parameters and the where clause of an item. The span runs from `<`
 * to the end of the where clause, so on an item with both it also covers what
 * is written between them (a function's parameters and return type). An item
 * without either has an empty span at the position the `<` would take.
 */
export interface Generics extends Span {
  kind: "Generics";
  params: GenericParam[];
  where: WherePredicate[];
}

export type GenericParam = LifetimeParam | TypeParam | ConstParam;

export interface LifetimeParam extends Span {
  kind: "LifetimeParam";
  attrs: Attribute[];
  name: string;
  bounds: Lifetime[];
}

export interface TypeParam extends Span {
  kind: "TypeParam";
  attrs: Attribute[];
  name: string;
  bounds: Bound[];
  default: Type | null;
}

export interface ConstParam extends Span {
  kind: "ConstParam";
  attrs: Attribute[];
  name: string;
  ty: Type;
  default: Expr | null;
}

export type WherePredicate = WhereType | WhereLifetime;

export interface WhereType extends Span {
  kind: "WhereType";
  /** `for<'a>` binder. */
  forLifetimes: LifetimeParam[];
  ty: Type;
  bounds: Bound[];
}

export interface WhereLifetime extends Span {
  kind: "WhereLifetime";
  lifetime: Lifetime;
  bounds: Lifetime[];
}

export type Bound = TraitBound | Lifetime | UseBound;

export interface TraitBound extends Span {
  kind: "TraitBound";
  /** `?Trait` (`?Sized`). */
  maybe: boolean;
  /** `~const Trait`, `const Trait`, `[const] Trait`, or null. */
  constness: "~const" | "const" | "[const]" | null;
  /** `async Fn(...)`. */
  async: boolean;
  /** `for<'a>` binder. */
  forLifetimes: LifetimeParam[];
  path: Path;
}

/** Precise capturing: `use<'a, T>`. */
export interface UseBound extends Span {
  kind: "UseBound";
  args: string[];
}

// ---------------------------------------------------------------------------
// Types

export type Type =
  | TypePath
  | TypeRef
  | TypePtr
  | TypeArray
  | TypeSlice
  | TypeTuple
  | TypeNever
  | TypeInfer
  | TypeBareFn
  | TypeTraitObject
  | TypeImplTrait
  | TypeParen
  | Macro;

export interface TypePath extends Span {
  kind: "TypePath";
  path: Path;
}

export interface TypeRef extends Span {
  kind: "TypeRef";
  lifetime: Lifetime | null;
  mutable: boolean;
  elem: Type;
}

export interface TypePtr extends Span {
  kind: "TypePtr";
  mutable: boolean;
  elem: Type;
}

export interface TypeArray extends Span {
  kind: "TypeArray";
  elem: Type;
  len: Expr;
}

export interface TypeSlice extends Span {
  kind: "TypeSlice";
  elem: Type;
}

/** Also the unit type `()`. */
export interface TypeTuple extends Span {
  kind: "TypeTuple";
  elems: Type[];
}

export interface TypeNever extends Span {
  kind: "TypeNever";
}

export interface TypeInfer extends Span {
  kind: "TypeInfer";
}

export interface BareFnParam extends Span {
  kind: "BareFnParam";
  attrs: Attribute[];
  name: string | null;
  ty: Type;
}

export interface TypeBareFn extends Span {
  kind: "TypeBareFn";
  forLifetimes: LifetimeParam[];
  unsafe: boolean;
  /** `"C"` for `extern "C" fn`, `""` for bare `extern fn`, null when not extern. */
  abi: string | null;
  params: BareFnParam[];
  variadic: boolean;
  ret: Type | null;
}

export interface TypeTraitObject extends Span {
  kind: "TypeTraitObject";
  /** Written with the `dyn` keyword. */
  dyn: boolean;
  bounds: Bound[];
}

export interface TypeImplTrait extends Span {
  kind: "TypeImplTrait";
  bounds: Bound[];
}

export interface TypeParen extends Span {
  kind: "TypeParen";
  elem: Type;
}

// ---------------------------------------------------------------------------
// Patterns

export type Pat =
  | PatWild
  | PatIdent
  | PatLit
  | PatRange
  | PatRef
  | PatStruct
  | PatTupleStruct
  | PatTuple
  | PatSlice
  | PatPath
  | PatOr
  | PatRest
  | PatParen
  | PatConst
  | PatBox
  | Macro;

export interface PatWild extends Span {
  kind: "PatWild";
}

/** A binding: `x`, `mut x`, `ref x`, `ref mut x`, `x @ sub`. */
export interface PatIdent extends Span {
  kind: "PatIdent";
  byRef: boolean;
  mutable: boolean;
  name: string;
  sub: Pat | null;
}

/** A literal pattern. `expr` is a `Lit`, or `Unary` with op `-` around one. */
export interface PatLit extends Span {
  kind: "PatLit";
  expr: Expr;
}

export interface PatRange extends Span {
  kind: "PatRange";
  lo: Expr | null;
  hi: Expr | null;
  inclusive: boolean;
}

export interface PatRef extends Span {
  kind: "PatRef";
  mutable: boolean;
  pat: Pat;
}

export interface FieldPat extends Span {
  kind: "FieldPat";
  attrs: Attribute[];
  /** Field name or tuple index. */
  member: string;
  pat: Pat;
  /** `Foo { x }` rather than `Foo { x: x }`. */
  shorthand: boolean;
}

export interface PatStruct extends Span {
  kind: "PatStruct";
  path: Path;
  fields: FieldPat[];
  /** Ends with `..`. */
  rest: boolean;
}

export interface PatTupleStruct extends Span {
  kind: "PatTupleStruct";
  path: Path;
  elems: Pat[];
}

export interface PatTuple extends Span {
  kind: "PatTuple";
  elems: Pat[];
}

export interface PatSlice extends Span {
  kind: "PatSlice";
  elems: Pat[];
}

export interface PatPath extends Span {
  kind: "PatPath";
  path: Path;
}

export interface PatOr extends Span {
  kind: "PatOr";
  alts: Pat[];
}

export interface PatRest extends Span {
  kind: "PatRest";
}

export interface PatParen extends Span {
  kind: "PatParen";
  pat: Pat;
}

export interface PatConst extends Span {
  kind: "PatConst";
  block: Block;
}

export interface PatBox extends Span {
  kind: "PatBox";
  pat: Pat;
}

// ---------------------------------------------------------------------------
// Expressions

export type Expr =
  | Lit
  | PathExpr
  | Unary
  | Binary
  | Assign
  | AssignOp
  | Ref
  | Cast
  | Call
  | MethodCall
  | Field
  | Index
  | Try
  | Await
  | BlockExpr
  | Unsafe
  | Async
  | ConstBlock
  | TryBlock
  | If
  | Let
  | Match
  | While
  | Loop
  | ForLoop
  | Closure
  | Return
  | Break
  | Continue
  | Range
  | StructExpr
  | Tuple
  | Array
  | Repeat
  | Paren
  | Yield
  | Infer
  | Macro;

interface ExprBase extends Span {
  /** Outer attributes written on the expression, when there are any. */
  attrs?: Attribute[];
}

export type LitKind = "int" | "float" | "str" | "byteStr" | "cStr" | "char" | "byte" | "bool";

export interface Lit extends ExprBase {
  kind: "Lit";
  litKind: LitKind;
  /** Source text, e.g. `1_000u32`, `b'\n'`, `r#"x"#`. */
  text: string;
  /** `u8`, `f32`, ... for numeric literals. */
  suffix: string | null;
}

export interface PathExpr extends ExprBase {
  kind: "PathExpr";
  path: Path;
}

export interface Unary extends ExprBase {
  kind: "Unary";
  op: "-" | "!" | "*";
  expr: Expr;
}

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "^"
  | "&"
  | "|"
  | "<<"
  | ">>"
  | "&&"
  | "||"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">=";

export interface Binary extends ExprBase {
  kind: "Binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export interface Assign extends ExprBase {
  kind: "Assign";
  left: Expr;
  right: Expr;
}

export interface AssignOp extends ExprBase {
  kind: "AssignOp";
  /** `+=`, `-=`, ... */
  op: string;
  left: Expr;
  right: Expr;
}

/** `&x`, `&mut x`, `&raw const x`, `&raw mut x`. */
export interface Ref extends ExprBase {
  kind: "Ref";
  mutable: boolean;
  raw: boolean;
  expr: Expr;
}

export interface Cast extends ExprBase {
  kind: "Cast";
  expr: Expr;
  ty: Type;
}

export interface Call extends ExprBase {
  kind: "Call";
  callee: Expr;
  args: Expr[];
}

export interface MethodCall extends ExprBase {
  kind: "MethodCall";
  receiver: Expr;
  method: string;
  turbofish: AngleArgs | null;
  args: Expr[];
}

export interface Field extends ExprBase {
  kind: "Field";
  expr: Expr;
  /** Field name or tuple index (`0`). */
  member: string;
}

export interface Index extends ExprBase {
  kind: "Index";
  expr: Expr;
  index: Expr;
}

export interface Try extends ExprBase {
  kind: "Try";
  expr: Expr;
}

export interface Await extends ExprBase {
  kind: "Await";
  expr: Expr;
}

export interface BlockExpr extends ExprBase {
  kind: "BlockExpr";
  label: string | null;
  block: Block;
}

export interface Unsafe extends ExprBase {
  kind: "Unsafe";
  block: Block;
}

export interface Async extends ExprBase {
  kind: "Async";
  move: boolean;
  block: Block;
}

export interface ConstBlock extends ExprBase {
  kind: "ConstBlock";
  block: Block;
}

export interface TryBlock extends ExprBase {
  kind: "TryBlock";
  block: Block;
}

export interface If extends ExprBase {
  kind: "If";
  cond: Expr;
  then: Block;
  /** An `If` (for `else if`) or a `BlockExpr`. */
  else: Expr | null;
}

/** `let PAT = EXPR` inside an `if` or `while` condition. */
export interface Let extends ExprBase {
  kind: "Let";
  pat: Pat;
  expr: Expr;
}

export interface MatchArm extends Span {
  kind: "MatchArm";
  attrs: Attribute[];
  pat: Pat;
  guard: Expr | null;
  body: Expr;
}

/** `attrs` also holds the inner attributes written at the start of the body. */
export interface Match extends ExprBase {
  kind: "Match";
  expr: Expr;
  arms: MatchArm[];
}

export interface While extends ExprBase {
  kind: "While";
  label: string | null;
  cond: Expr;
  body: Block;
}

export interface Loop extends ExprBase {
  kind: "Loop";
  label: string | null;
  body: Block;
}

export interface ForLoop extends ExprBase {
  kind: "ForLoop";
  label: string | null;
  pat: Pat;
  expr: Expr;
  body: Block;
}

export interface ClosureParam extends Span {
  kind: "ClosureParam";
  attrs: Attribute[];
  pat: Pat;
  ty: Type | null;
}

export interface Closure extends ExprBase {
  kind: "Closure";
  move: boolean;
  async: boolean;
  static: boolean;
  params: ClosureParam[];
  ret: Type | null;
  body: Expr;
}

export interface Return extends ExprBase {
  kind: "Return";
  expr: Expr | null;
}

export interface Break extends ExprBase {
  kind: "Break";
  label: string | null;
  expr: Expr | null;
}

export interface Continue extends ExprBase {
  kind: "Continue";
  label: string | null;
}

export interface Range extends ExprBase {
  kind: "Range";
  lo: Expr | null;
  hi: Expr | null;
  inclusive: boolean;
}

export interface FieldValue extends Span {
  kind: "FieldValue";
  attrs: Attribute[];
  /** Field name or tuple index. */
  member: string;
  expr: Expr;
  /** `Foo { x }` rather than `Foo { x: x }`. */
  shorthand: boolean;
}

export interface StructExpr extends ExprBase {
  kind: "StructExpr";
  path: Path;
  fields: FieldValue[];
  /** The base in `..base`, or null. */
  rest: Expr | null;
  /** Ends with `..` (with or without a base). */
  hasRest: boolean;
}

/** Also the unit value `()`. */
export interface Tuple extends ExprBase {
  kind: "Tuple";
  elems: Expr[];
}

export interface Array extends ExprBase {
  kind: "Array";
  elems: Expr[];
}

/** `[elem; len]` */
export interface Repeat extends ExprBase {
  kind: "Repeat";
  elem: Expr;
  len: Expr;
}

export interface Paren extends ExprBase {
  kind: "Paren";
  expr: Expr;
}

export interface Yield extends ExprBase {
  kind: "Yield";
  expr: Expr | null;
}

/** `_` in expression position (destructuring assignment). */
export interface Infer extends ExprBase {
  kind: "Infer";
}

/**
 * A macro invocation `path!(...)`, `path![...]`, or `path! { ... }`. Valid in
 * item, statement, expression, type, and pattern position.
 */
export interface Macro extends ExprBase {
  kind: "Macro";
  attrs?: Attribute[];
  path: Path;
  delim: "(" | "[" | "{";
  /** Everything between the delimiters, as token trees. */
  tokens: TokenTree[];
  /**
   * Best-effort view of the input as comma-separated expressions. One entry
   * per top-level comma-separated chunk. An entry is null when that chunk does
   * not parse as an expression (a pattern in `matches!`, `[x; n]` repeats, a
   * DSL, ...).
   */
  args: (Expr | null)[];
}

// ---------------------------------------------------------------------------
// Statements and blocks

export type Stmt = Local | Item | ExprStmt | Empty;

export interface Local extends Span {
  kind: "Local";
  attrs: Attribute[];
  pat: Pat;
  ty: Type | null;
  init: Expr | null;
  /** The `else { ... }` block of `let ... else`. */
  else: Block | null;
}

export interface ExprStmt extends Span {
  kind: "ExprStmt";
  attrs: Attribute[];
  expr: Expr;
  /** Ends with `;`. A block-like statement or a tail expression does not. */
  semi: boolean;
}

export interface Empty extends Span {
  kind: "Empty";
}

export interface Block extends Span {
  kind: "Block";
  attrs: Attribute[];
  stmts: Stmt[];
}

// ---------------------------------------------------------------------------
// Items

export type Item =
  | Fn
  | Struct
  | Enum
  | Union
  | Trait
  | Impl
  | Mod
  | Use
  | Const
  | Static
  | TypeAlias
  | ExternCrate
  | ForeignMod
  | MacroRules
  | Macro;

/** Visibility as written: `pub`, `pub(crate)`, `pub(super)`, `pub(self)`, `pub(in path)`. */
export type Visibility = string | null;

export interface Receiver extends Span {
  kind: "Receiver";
  attrs: Attribute[];
  /** `&self` / `&mut self` (as opposed to `self` / `mut self` / `self: T`). */
  ref: boolean;
  lifetime: Lifetime | null;
  /** The `mut` in `&mut self` or `mut self`. */
  mutable: boolean;
  /** The type in `self: Box<Self>`. */
  ty: Type | null;
}

export interface Param extends Span {
  kind: "Param";
  attrs: Attribute[];
  /** Null for an unnamed parameter (`fn(u32)` in a foreign block or a 2015 trait). */
  pat: Pat | null;
  ty: Type;
}

export type FnParam = Receiver | Param;

export interface Fn extends Span {
  kind: "Fn";
  attrs: Attribute[];
  vis: Visibility;
  const: boolean;
  async: boolean;
  unsafe: boolean;
  /** `safe fn` inside an `unsafe extern` block. */
  safe: boolean;
  default: boolean;
  /** `"C"` for `extern "C" fn`, `""` for bare `extern fn`, null when not extern. */
  abi: string | null;
  name: string;
  generics: Generics;
  params: FnParam[];
  variadic: boolean;
  ret: Type | null;
  /** Null for a declaration (trait method without default, foreign fn). */
  body: Block | null;
}

export interface StructField extends Span {
  kind: "StructField";
  attrs: Attribute[];
  vis: Visibility;
  /** Null for tuple struct fields. */
  name: string | null;
  ty: Type;
}

export interface Struct extends Span {
  kind: "Struct";
  attrs: Attribute[];
  vis: Visibility;
  name: string;
  generics: Generics;
  /** Null for a unit struct. */
  fields: StructField[] | null;
  tuple: boolean;
}

export interface Variant extends Span {
  kind: "Variant";
  attrs: Attribute[];
  name: string;
  /** Null for a unit variant. */
  fields: StructField[] | null;
  tuple: boolean;
  discriminant: Expr | null;
}

export interface Enum extends Span {
  kind: "Enum";
  attrs: Attribute[];
  vis: Visibility;
  name: string;
  generics: Generics;
  variants: Variant[];
}

export interface Union extends Span {
  kind: "Union";
  attrs: Attribute[];
  vis: Visibility;
  name: string;
  generics: Generics;
  fields: StructField[];
}

export interface Trait extends Span {
  kind: "Trait";
  /** Outer attributes, then the inner attributes of the body. */
  attrs: Attribute[];
  vis: Visibility;
  unsafe: boolean;
  auto: boolean;
  name: string;
  generics: Generics;
  supertraits: Bound[];
  items: Item[];
}

export interface Impl extends Span {
  kind: "Impl";
  /** Outer attributes, then the inner attributes of the body. */
  attrs: Attribute[];
  unsafe: boolean;
  default: boolean;
  /** `impl const Trait for T`. */
  const: boolean;
  generics: Generics;
  /** `impl !Trait for T`. */
  negative: boolean;
  /** Null for an inherent impl. */
  trait: Path | null;
  selfTy: Type;
  items: Item[];
}

export interface Mod extends Span {
  kind: "Mod";
  attrs: Attribute[];
  vis: Visibility;
  unsafe: boolean;
  name: string;
  /** Null for `mod name;`. Inner attributes of an inline module are in `attrs`. */
  items: Item[] | null;
}

export type UseTree = UsePath | UseName | UseRename | UseGlob | UseGroup;

export interface UsePath extends Span {
  kind: "UsePath";
  name: string;
  tree: UseTree;
}

export interface UseName extends Span {
  kind: "UseName";
  name: string;
}

export interface UseRename extends Span {
  kind: "UseRename";
  name: string;
  rename: string;
}

export interface UseGlob extends Span {
  kind: "UseGlob";
}

export interface UseGroup extends Span {
  kind: "UseGroup";
  items: UseTree[];
}

export interface Use extends Span {
  kind: "Use";
  attrs: Attribute[];
  vis: Visibility;
  /** Leading `::`. */
  global: boolean;
  tree: UseTree;
}

export interface Const extends Span {
  kind: "Const";
  attrs: Attribute[];
  vis: Visibility;
  default: boolean;
  /** `_` for `const _: () = ...`. */
  name: string;
  generics: Generics;
  ty: Type | null;
  /** Null for a trait const without a default. */
  expr: Expr | null;
}

export interface Static extends Span {
  kind: "Static";
  attrs: Attribute[];
  vis: Visibility;
  mutable: boolean;
  /** `safe static` / `unsafe static` in an extern block. */
  safe: boolean;
  unsafe: boolean;
  name: string;
  ty: Type;
  /** Null for a foreign static. */
  expr: Expr | null;
}

export interface TypeAlias extends Span {
  kind: "TypeAlias";
  attrs: Attribute[];
  vis: Visibility;
  default: boolean;
  name: string;
  generics: Generics;
  /** `type Item: Bound;` in a trait. */
  bounds: Bound[];
  /** Null for an associated type declaration. */
  ty: Type | null;
}

export interface ExternCrate extends Span {
  kind: "ExternCrate";
  attrs: Attribute[];
  vis: Visibility;
  name: string;
  rename: string | null;
}

/** `extern "C" { ... }` */
export interface ForeignMod extends Span {
  kind: "ForeignMod";
  /** Outer attributes, then the inner attributes of the block. */
  attrs: Attribute[];
  unsafe: boolean;
  /** `"C"` for `extern "C"`, `""` for bare `extern`. */
  abi: string;
  items: Item[];
}

export interface MacroRules extends Span {
  kind: "MacroRules";
  attrs: Attribute[];
  name: string;
  delim: "(" | "[" | "{";
  tokens: TokenTree[];
}

// ---------------------------------------------------------------------------
// File

export interface File extends Span {
  kind: "File";
  attrs: Attribute[];
  items: Item[];
}

/** Every node kind that `walk` visits. */
export type Node =
  | File
  | Attribute
  | Path
  | PathSegment
  | AngleArgs
  | ParenArgs
  | GenericArg
  | Generics
  | GenericParam
  | WherePredicate
  | Bound
  | Type
  | BareFnParam
  | Pat
  | FieldPat
  | Expr
  | MatchArm
  | ClosureParam
  | FieldValue
  | Stmt
  | Block
  | Item
  | Receiver
  | Param
  | StructField
  | Variant
  | UseTree;

export type NodeKind = Node["kind"];

export type NodeOfKind<K extends NodeKind> = Extract<Node, { kind: K }>;

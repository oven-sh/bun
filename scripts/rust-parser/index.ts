// A Rust parser in TypeScript, with a query API for source lints.
//
//   import { parseRust } from "../../../scripts/rust-parser/index.ts";
//
//   const file = parseRust(source, "src/foo.rs");
//   for (const fn of file.find("Fn")) {
//     if (!fn.params.some(p => p.kind === "Receiver")) continue;   // methods only
//     for (const call of file.find("Call", fn)) {
//       if (pathEndsWith(call.callee, "heap::take")) {
//         console.log(file.location(call), file.text(call));
//       }
//     }
//   }
//
// The parser covers the full stable grammar plus the nightly features the
// tree uses. Macro input is kept as token trees and, where it looks like
// comma-separated expressions, also parsed (`Macro.args`), so queries see
// through `assert!`, `format!`, `matches!`, and friends. Comments are kept
// with their positions in `RustFile.comments`.

import type * as ast from "./ast.ts";
import { flattenTokenTrees, type Token } from "./lexer.ts";
import {
  attributesInTokens,
  parseExpr,
  parseFile,
  parsePat,
  parseStmts,
  parseType,
  type ParseOptions,
} from "./parser-items.ts";

export type * from "./ast.ts";
export { buildTokenTrees, flattenTokenTrees, lex, splitTokenTrees, tokenTreesText } from "./lexer.ts";
export type { LiteralKind, Token, TokenKind } from "./lexer.ts";
export { RustParseError } from "./parser-base.ts";
export { attributesInTokens, parseExpr as parseRustExpr, parsePat as parseRustPat, parseType as parseRustType };

type Node = ast.Node;
type NodeKind = ast.NodeKind;
type NodeOfKind<K extends NodeKind> = ast.NodeOfKind<K>;

// ---------------------------------------------------------------------------
// Traversal

/** Keys whose values are never child nodes. */
const SKIP_KEYS = new Set(["kind", "start", "end", "tokens", "meta", "attrs"]);

function isNode(v: unknown): v is Node {
  return (
    v !== null && typeof v === "object" && typeof (v as Node).kind === "string" && typeof (v as Node).start === "number"
  );
}

/**
 * `children` computed by reflection over the node's fields. Slower than
 * `children`; exists so a test can check the two agree.
 */
export function childrenReflective(node: Node): Node[] {
  const out: Node[] = [];
  const attrs = (node as { attrs?: ast.Attribute[] }).attrs;
  if (attrs) for (const a of attrs) out.push(a);
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const v = (node as unknown as Record<string, unknown>)[key];
    if (v === null || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const el of v) if (isNode(el)) out.push(el);
    } else if (isNode(v)) {
      out.push(v);
    }
  }
  return out;
}

function push(out: Node[], v: Node | null | undefined): void {
  if (v) out.push(v);
}

function pushAll(out: Node[], vs: readonly (Node | null)[]): void {
  for (const v of vs) if (v) out.push(v);
}

/**
 * Direct child nodes, in source order. Attributes come first. Token trees
 * (macro input, `macro_rules!` bodies) are not nodes and are skipped; the
 * parsed `Macro.args` expressions are visited.
 */
export function children(node: Node): Node[] {
  const out: Node[] = [];
  const attrs = (node as { attrs?: ast.Attribute[] }).attrs;
  if (attrs) for (const a of attrs) out.push(a);
  switch (node.kind) {
    case "File":
    case "Mod":
    case "ForeignMod":
      if (node.items) pushAll(out, node.items);
      break;
    case "Attribute":
      push(out, node.path);
      push(out, node.value);
      break;
    case "Path":
      push(out, node.qself);
      push(out, node.asTrait);
      pushAll(out, node.segments);
      break;
    case "PathSegment":
      push(out, node.args);
      break;
    case "AngleArgs":
      pushAll(out, node.args);
      break;
    case "ParenArgs":
      pushAll(out, node.inputs);
      push(out, node.output);
      break;
    case "ConstArg":
    case "PatLit":
    case "Unary":
    case "Ref":
    case "Field":
    case "Try":
    case "Await":
    case "Paren":
    case "Return":
    case "Break":
    case "Yield":
    case "ExprStmt":
    case "Let":
      if (node.kind === "Let") push(out, node.pat);
      push(out, node.expr);
      break;
    case "AssocBinding":
      push(out, node.args);
      push(out, node.ty);
      push(out, node.value);
      break;
    case "AssocConstraint":
      push(out, node.args);
      pushAll(out, node.bounds);
      break;
    case "Generics":
      pushAll(out, node.params);
      pushAll(out, node.where);
      break;
    case "LifetimeParam":
      pushAll(out, node.bounds);
      break;
    case "TypeParam":
      pushAll(out, node.bounds);
      push(out, node.default);
      break;
    case "ConstParam":
      push(out, node.ty);
      push(out, node.default);
      break;
    case "WhereType":
      pushAll(out, node.forLifetimes);
      push(out, node.ty);
      pushAll(out, node.bounds);
      break;
    case "WhereLifetime":
      push(out, node.lifetime);
      pushAll(out, node.bounds);
      break;
    case "TraitBound":
      pushAll(out, node.forLifetimes);
      push(out, node.path);
      break;
    case "TypePath":
    case "PatPath":
    case "PathExpr":
      push(out, node.path);
      break;
    case "TypeRef":
      push(out, node.lifetime);
      push(out, node.elem);
      break;
    case "TypePtr":
    case "TypeSlice":
    case "TypeParen":
      push(out, node.elem);
      break;
    case "TypeArray":
      push(out, node.elem);
      push(out, node.len);
      break;
    case "TypeTuple":
      pushAll(out, node.elems);
      break;
    case "BareFnParam":
    case "StructField":
      push(out, node.ty);
      break;
    case "TypeBareFn":
      pushAll(out, node.forLifetimes);
      pushAll(out, node.params);
      push(out, node.ret);
      break;
    case "TypeTraitObject":
    case "TypeImplTrait":
      pushAll(out, node.bounds);
      break;
    case "PatIdent":
      push(out, node.sub);
      break;
    case "PatRange":
    case "Range":
      push(out, node.lo);
      push(out, node.hi);
      break;
    case "PatRef":
    case "PatParen":
    case "PatBox":
    case "FieldPat":
      push(out, node.pat);
      break;
    case "PatStruct":
      push(out, node.path);
      pushAll(out, node.fields);
      break;
    case "PatTupleStruct":
      push(out, node.path);
      pushAll(out, node.elems);
      break;
    case "PatTuple":
    case "PatSlice":
    case "Tuple":
    case "Array":
      pushAll(out, node.elems);
      break;
    case "PatOr":
      pushAll(out, node.alts);
      break;
    case "PatConst":
    case "BlockExpr":
    case "Unsafe":
    case "Async":
    case "ConstBlock":
    case "TryBlock":
      push(out, node.block);
      break;
    case "Binary":
    case "Assign":
    case "AssignOp":
      push(out, node.left);
      push(out, node.right);
      break;
    case "Cast":
      push(out, node.expr);
      push(out, node.ty);
      break;
    case "Call":
      push(out, node.callee);
      pushAll(out, node.args);
      break;
    case "MethodCall":
      push(out, node.receiver);
      push(out, node.turbofish);
      pushAll(out, node.args);
      break;
    case "Index":
      push(out, node.expr);
      push(out, node.index);
      break;
    case "If":
      push(out, node.cond);
      push(out, node.then);
      push(out, node.else);
      break;
    case "MatchArm":
      push(out, node.pat);
      push(out, node.guard);
      push(out, node.body);
      break;
    case "Match":
      push(out, node.expr);
      pushAll(out, node.arms);
      break;
    case "While":
      push(out, node.cond);
      push(out, node.body);
      break;
    case "Loop":
      push(out, node.body);
      break;
    case "ForLoop":
      push(out, node.pat);
      push(out, node.expr);
      push(out, node.body);
      break;
    case "ClosureParam":
    case "Param":
      push(out, node.pat);
      push(out, node.ty);
      break;
    case "Closure":
      pushAll(out, node.params);
      push(out, node.ret);
      push(out, node.body);
      break;
    case "FieldValue":
      push(out, node.expr);
      break;
    case "StructExpr":
      push(out, node.path);
      pushAll(out, node.fields);
      push(out, node.rest);
      break;
    case "Repeat":
      push(out, node.elem);
      push(out, node.len);
      break;
    case "Macro":
      push(out, node.path);
      pushAll(out, node.args);
      break;
    case "Local":
      push(out, node.pat);
      push(out, node.ty);
      push(out, node.init);
      push(out, node.else);
      break;
    case "Block":
      pushAll(out, node.stmts);
      break;
    case "Receiver":
      push(out, node.lifetime);
      push(out, node.ty);
      break;
    case "Fn":
      push(out, node.generics);
      pushAll(out, node.params);
      push(out, node.ret);
      push(out, node.body);
      break;
    case "Struct":
    case "Union":
      push(out, node.generics);
      if (node.fields) pushAll(out, node.fields);
      break;
    case "Variant":
      if (node.fields) pushAll(out, node.fields);
      push(out, node.discriminant);
      break;
    case "Enum":
      push(out, node.generics);
      pushAll(out, node.variants);
      break;
    case "Trait":
      push(out, node.generics);
      pushAll(out, node.supertraits);
      pushAll(out, node.items);
      break;
    case "Impl":
      push(out, node.generics);
      push(out, node.trait);
      push(out, node.selfTy);
      pushAll(out, node.items);
      break;
    case "UsePath":
    case "Use":
      push(out, node.tree);
      break;
    case "UseGroup":
      pushAll(out, node.items);
      break;
    case "Const":
      push(out, node.generics);
      push(out, node.ty);
      push(out, node.expr);
      break;
    case "Static":
      push(out, node.ty);
      push(out, node.expr);
      break;
    case "TypeAlias":
      push(out, node.generics);
      pushAll(out, node.bounds);
      push(out, node.ty);
      break;
    // Leaves.
    case "Lifetime":
    case "UseBound":
    case "TypeNever":
    case "TypeInfer":
    case "PatWild":
    case "PatRest":
    case "Lit":
    case "Continue":
    case "Infer":
    case "Empty":
    case "UseName":
    case "UseRename":
    case "UseGlob":
    case "ExternCrate":
    case "MacroRules":
      break;
  }
  return out;
}

/**
 * Pre-order traversal. `visit` returning `false` skips the node's subtree.
 */
export function walk(root: Node, visit: (node: Node, parent: Node | null) => boolean | void): void {
  const nodes: Node[] = [root];
  const parents: (Node | null)[] = [null];
  while (nodes.length > 0) {
    const node = nodes.pop()!;
    const parent = parents.pop()!;
    if (visit(node, parent) === false) continue;
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--) {
      nodes.push(kids[i]);
      parents.push(node);
    }
  }
}

/** All descendants of `root` in pre-order, `root` excluded. */
export function* descendants(root: Node): Generator<Node> {
  const stack: Node[] = children(root).reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

/** Every node of kind `kind` under `root` (`root` included), in source order. */
export function find<K extends NodeKind>(root: Node, kind: K): NodeOfKind<K>[] {
  const out: NodeOfKind<K>[] = [];
  walk(root, node => {
    if (node.kind === kind) out.push(node as NodeOfKind<K>);
  });
  return out;
}

/** Every node under `root` (`root` included) for which `pred` holds, in source order. */
export function findAll<T extends Node = Node>(root: Node, pred: (node: Node) => node is T): T[];
export function findAll(root: Node, pred: (node: Node) => boolean): Node[];
export function findAll(root: Node, pred: (node: Node) => boolean): Node[] {
  const out: Node[] = [];
  walk(root, node => {
    if (pred(node)) out.push(node);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Paths

/** `a::b::C` for a path, generic arguments dropped. `<T as Tr>::x` becomes `<T as Tr>::x` with the type rendered the same way. */
export function pathString(path: ast.Path): string {
  let s = path.segments.map(seg => seg.name).join("::");
  if (path.global) s = "::" + s;
  if (path.qself) {
    const q = typeString(path.qself);
    s = (path.asTrait ? `<${q} as ${pathString(path.asTrait)}>` : `<${q}>`) + "::" + s;
  }
  return s;
}

/** A compact rendering of a type, generic arguments dropped (`Vec`, `&mut [u8]`, `*const T`). */
export function typeString(ty: ast.Type): string {
  switch (ty.kind) {
    case "TypePath":
      return pathString(ty.path);
    case "TypeRef":
      return `&${ty.mutable ? "mut " : ""}${typeString(ty.elem)}`;
    case "TypePtr":
      return `*${ty.mutable ? "mut" : "const"} ${typeString(ty.elem)}`;
    case "TypeArray":
      return `[${typeString(ty.elem)}; _]`;
    case "TypeSlice":
      return `[${typeString(ty.elem)}]`;
    case "TypeTuple":
      return `(${ty.elems.map(typeString).join(", ")})`;
    case "TypeNever":
      return "!";
    case "TypeInfer":
      return "_";
    case "TypeBareFn":
      return `${ty.unsafe ? "unsafe " : ""}${ty.abi !== null ? `extern "${ty.abi}" ` : ""}fn(${ty.params.map(p => typeString(p.ty)).join(", ")})${ty.ret ? " -> " + typeString(ty.ret) : ""}`;
    case "TypeTraitObject":
      return `${ty.dyn ? "dyn " : ""}${ty.bounds.map(boundString).join(" + ")}`;
    case "TypeImplTrait":
      return `impl ${ty.bounds.map(boundString).join(" + ")}`;
    case "TypeParen":
      return `(${typeString(ty.elem)})`;
    case "Macro":
      return pathString(ty.path) + "!";
  }
}

function boundString(b: ast.Bound): string {
  switch (b.kind) {
    case "Lifetime":
      return b.name;
    case "TraitBound":
      return (b.maybe ? "?" : "") + pathString(b.path);
    case "UseBound":
      return `use<${b.args.join(", ")}>`;
  }
}

/** Last segment name of a path. */
export function pathLast(path: ast.Path): string {
  return path.segments[path.segments.length - 1].name;
}

/**
 * Whether `path` is exactly `name` or ends with `::name`, generic arguments
 * ignored. `pathEndsWith(p, "heap::take")` matches `heap::take`,
 * `bun_core::heap::take`, and `bun_core::heap::take::<T>`.
 */
export function pathEndsWith(path: ast.Path | ast.Expr | ast.Type, name: string): boolean {
  const p = asPath(path);
  if (p === null) return false;
  const want = name.split("::");
  const segs = p.segments;
  if (want.length > segs.length) return false;
  for (let i = 0; i < want.length; i++) {
    if (segs[segs.length - want.length + i].name !== want[i]) return false;
  }
  return true;
}

/** The path inside a `Path`, `PathExpr`, `TypePath`, or `PatPath`, else null. */
export function asPath(node: Node): ast.Path | null {
  switch (node.kind) {
    case "Path":
      return node;
    case "PathExpr":
    case "TypePath":
    case "PatPath":
      return node.path;
    default:
      return null;
  }
}

/** Whether `expr` is a plain path expression spelling `name` (`self`, `JSValue::ZERO`). */
export function isPathExpr(expr: ast.Expr, name: string): boolean {
  return expr.kind === "PathExpr" && expr.path.qself === null && pathString(expr.path) === name;
}

/** Whether `expr` is the bare `self`. */
export function isSelf(expr: ast.Expr): boolean {
  return isPathExpr(expr, "self");
}

/** Strips `Paren` wrappers. */
export function unwrapParens(expr: ast.Expr): ast.Expr {
  while (expr.kind === "Paren") expr = expr.expr;
  return expr;
}

// ---------------------------------------------------------------------------
// Attributes

/**
 * Every `MetaList` named `name` reachable from `meta`, including through
 * `cfg_attr(pred, ...)` wrappers and nested lists. For
 * `#[cfg_attr(test, allow(dead_code))]`, `metaLists(attr.meta, "allow")`
 * returns the inner `allow(dead_code)` list.
 */
export function metaLists(meta: ast.Meta, name: string): ast.MetaList[] {
  const out: ast.MetaList[] = [];
  const visit = (m: ast.Meta) => {
    if (m.kind !== "MetaList") return;
    if (m.path === name) out.push(m);
    for (const item of m.items) visit(item);
  };
  visit(meta);
  return out;
}

/** Paths of the direct items of a meta list (`allow(a, b::c)` gives `["a", "b::c"]`). */
export function metaItemPaths(list: ast.MetaList): string[] {
  const out: string[] = [];
  for (const item of list.items) {
    if (item.kind === "MetaPath" || item.kind === "MetaList" || item.kind === "MetaNameValue") out.push(item.path);
  }
  return out;
}

/** Whether `attrs` contains an attribute named `name` (`test`, `inline`, `unsafe`, ...). */
export function hasAttr(attrs: ast.Attribute[], name: string): boolean {
  return attrs.some(a => a.name === name);
}

// ---------------------------------------------------------------------------
// Literals

/**
 * Decodes a string-like literal (`"..."`, `r#"..."#`, `b"..."`, `c"..."`,
 * `'x'`, `b'x'`) to its value. Numeric and bool literals return null.
 */
export function litString(lit: ast.Lit): string | null {
  let text = lit.text;
  switch (lit.litKind) {
    case "str":
    case "byteStr":
    case "cStr": {
      const prefixLen = lit.litKind === "str" ? 0 : 1;
      text = text.slice(prefixLen);
      if (text.startsWith("r")) {
        const hashes = text.indexOf('"') - 1;
        return text.slice(hashes + 2, text.length - 1 - hashes);
      }
      return unescape(text.slice(1, -1));
    }
    case "char":
      return unescape(text.slice(1, -1));
    case "byte":
      return unescape(text.slice(2, -1));
    default:
      return null;
  }
}

function unescape(s: string): string {
  if (!s.includes("\\")) return s;
  return s.replace(/\\(?:u\{([0-9a-fA-F_]+)\}|x([0-9a-fA-F]{2})|(\r?\n\s*)|(.))/gs, (_, u, x, nl, c) => {
    if (u !== undefined) return String.fromCodePoint(parseInt(u.replace(/_/g, ""), 16));
    if (x !== undefined) return String.fromCharCode(parseInt(x, 16));
    if (nl !== undefined) return "";
    switch (c) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "0":
        return "\0";
      default:
        return c;
    }
  });
}

/** Numeric value of an int or float literal (suffix and underscores ignored), else null. */
export function litNumber(lit: ast.Lit): number | null {
  if (lit.litKind !== "int" && lit.litKind !== "float") return null;
  let text = lit.text.replace(/_/g, "");
  if (lit.suffix) text = text.slice(0, -lit.suffix.length);
  return Number(text);
}

// ---------------------------------------------------------------------------
// RustFile

/** Whether `node` is one of `holder`'s attributes (or nested inside one). */
function holdsAttr(holder: Node, node: Node): boolean {
  const attrs = (holder as { attrs?: ast.Attribute[] }).attrs;
  if (!attrs) return false;
  return attrs.some(a => a === node || (a.start <= node.start && node.end <= a.end));
}

export class RustFile {
  private lineStarts: number[] | null = null;

  constructor(
    readonly source: string,
    readonly path: string | undefined,
    readonly ast: ast.File,
    /** Every comment in the file, in order, with spans. Doc comments included. */
    readonly comments: ast.Comment[],
  ) {}

  /** Top-level items. */
  get items(): ast.Item[] {
    return this.ast.items;
  }

  /** Inner attributes (`#![...]`) of the file. */
  get attrs(): ast.Attribute[] {
    return this.ast.attrs;
  }

  /** Source text of a node. */
  text(node: ast.Span): string {
    return this.source.slice(node.start, node.end);
  }

  /** 1-based line of an offset or node. */
  lineOf(at: number | ast.Span): number {
    const offset = typeof at === "number" ? at : at.start;
    const starts = this.lineTable();
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** 1-based column of an offset or node. */
  columnOf(at: number | ast.Span): number {
    const offset = typeof at === "number" ? at : at.start;
    const line = this.lineOf(offset);
    return offset - this.lineTable()[line - 1] + 1;
  }

  /** `path:line` for a node, or `line` when the file has no path. */
  location(at: number | ast.Span): string {
    const line = this.lineOf(at);
    return this.path === undefined ? String(line) : `${this.path}:${line}`;
  }

  private lineTable(): number[] {
    if (this.lineStarts === null) {
      const starts = [0];
      const src = this.source;
      for (let i = src.indexOf("\n"); i !== -1; i = src.indexOf("\n", i + 1)) starts.push(i + 1);
      this.lineStarts = starts;
    }
    return this.lineStarts;
  }

  /** Pre-order traversal of the whole file, or of `root`. */
  walk(visit: (node: Node, parent: Node | null) => boolean | void, root: Node = this.ast): void {
    walk(root, visit);
  }

  /** Every node of kind `kind` in the file, or under `root`. */
  find<K extends NodeKind>(kind: K, root: Node = this.ast): NodeOfKind<K>[] {
    return find(root, kind);
  }

  /** Every node for which `pred` holds, in the file or under `root`. */
  findAll<T extends Node = Node>(pred: (node: Node) => node is T, root?: Node): T[];
  findAll(pred: (node: Node) => boolean, root?: Node): Node[];
  findAll(pred: (node: Node) => boolean, root: Node = this.ast): Node[] {
    return findAll(root, pred);
  }

  /**
   * Ancestors of a node, nearest first. Found by descending from the root
   * along span containment, so no parent index is kept in memory. Empty for
   * the root and for a node that is not in this file.
   */
  ancestors(node: Node): Node[] {
    const chain: Node[] = [];
    let cur: Node = this.ast;
    while (cur !== node) {
      // The tightest child whose span holds the node. Siblings rarely overlap,
      // but an item's `Generics` span runs to the end of its where clause and
      // so covers the parameters and return type written between them.
      // Attributes sit before the node they decorate, outside its span.
      let next: Node | null = null;
      for (const kid of children(cur)) {
        if (kid === node) {
          chain.push(cur);
          return chain.reverse();
        }
        const contains = kid.start <= node.start && node.end <= kid.end && kid.start < kid.end;
        if (!contains && !holdsAttr(kid, node)) continue;
        if (next === null || kid.end - kid.start < next.end - next.start) next = kid;
      }
      if (next === null) return [];
      chain.push(cur);
      cur = next;
    }
    return chain.reverse();
  }

  /** Parent of a node, or null for the root. */
  parent(node: Node): Node | null {
    return this.ancestors(node)[0] ?? null;
  }

  /** Nearest ancestor of kind `kind`, or null. */
  enclosing<K extends NodeKind>(node: Node, kind: K): NodeOfKind<K> | null {
    for (const p of this.ancestors(node)) {
      if (p.kind === kind) return p as NodeOfKind<K>;
    }
    return null;
  }

  /** The function whose body contains `node`, or null. */
  enclosingFn(node: Node): ast.Fn | null {
    return this.enclosing(node, "Fn");
  }

  /**
   * Every attribute in the file: the ones in the tree plus the ones spelled
   * inside macro input and `macro_rules!` bodies, which the tree keeps as
   * token trees. In source order.
   */
  allAttributes(): ast.Attribute[] {
    const attrs = this.find("Attribute");
    const seen = new Set<number>();
    for (const a of attrs) seen.add(a.start);
    const fromTokens = (tokens: ast.TokenTree[]) => {
      for (const a of attributesInTokens(tokens, this.source, this.path)) {
        if (!seen.has(a.start)) {
          seen.add(a.start);
          attrs.push(a);
        }
      }
    };
    this.walk(node => {
      if (node.kind === "Macro" || node.kind === "MacroRules") fromTokens(node.tokens);
    });
    return attrs.sort((a, b) => a.start - b.start);
  }

  /**
   * Every token inside macro input and `macro_rules!` bodies, which the tree
   * keeps as token trees, as one flat list in source order with delimiters as
   * `open`/`close` tokens. Each position appears once, although a macro nested
   * in another's input is reachable through both.
   */
  macroTokens(): Token[] {
    const out: Token[] = [];
    const seen = new Set<number>();
    this.walk(node => {
      if (node.kind !== "Macro" && node.kind !== "MacroRules") return;
      for (const t of flattenTokenTrees(node.tokens, node.end)) {
        if (t.kind === "eof" || seen.has(t.start)) continue;
        seen.add(t.start);
        out.push(t);
      }
    });
    return out.sort((a, b) => a.start - b.start);
  }

  /**
   * Comments whose text matches `pattern`, every style included (`//`, `///`,
   * `//!`, block). `offset` is the position of the first match in the file,
   * for `lineOf`/`location`.
   */
  commentsMatching(pattern: RegExp): { comment: ast.Comment; offset: number; match: RegExpExecArray }[] {
    const out: { comment: ast.Comment; offset: number; match: RegExpExecArray }[] = [];
    for (const comment of this.comments) {
      const match = pattern.exec(comment.text);
      if (match !== null) out.push({ comment, offset: comment.start + match.index, match });
    }
    return out;
  }

  /** Comments whose span lies inside `node`. */
  commentsIn(node: ast.Span): ast.Comment[] {
    return this.comments.filter(c => c.start >= node.start && c.end <= node.end);
  }

  /**
   * The `///` (or block) doc comments immediately above a node, attributes
   * between them and the node allowed.
   */
  docComments(node: Node): ast.Comment[] {
    let start = node.start;
    const attrs = (node as { attrs?: ast.Attribute[] }).attrs;
    if (attrs) for (const a of attrs) if (a.style === "outer" && a.start < start) start = a.start;
    const out: ast.Comment[] = [];
    // Walk comments backwards from the node start, accepting only doc comments
    // separated from the node (and from each other) by whitespace or attributes.
    let idx = this.comments.length - 1;
    while (idx >= 0 && this.comments[idx].start >= start) idx--;
    let limit = start;
    for (; idx >= 0; idx--) {
      const c = this.comments[idx];
      if (c.doc !== "outer") break;
      const between = this.source.slice(c.end, limit);
      if (!/^(?:\s|#\[[^\]]*\])*$/.test(between)) break;
      out.unshift(c);
      limit = c.start;
    }
    return out;
  }
}

/** Parses a Rust source file. Throws `RustParseError` on invalid syntax. */
export function parseRust(source: string, path?: string): RustFile {
  const { ast, comments } = parseFile(source, { path });
  return new RustFile(source, path, ast, comments);
}

/**
 * Parses a code fragment: statements, items, and an optional trailing
 * expression, as they would appear inside a function body. Useful for testing
 * a lint against snippets.
 */
export function parseRustFragment(source: string, options: ParseOptions = {}): RustFile {
  const { block, comments } = parseStmts(source, options);
  const file: ast.File = { kind: "File", attrs: [], items: [], start: 0, end: source.length };
  // Expose the block's statements through a synthetic function so queries
  // that look for an enclosing `Fn` keep working.
  const fn: ast.Fn = {
    kind: "Fn",
    attrs: [],
    vis: null,
    const: false,
    async: false,
    unsafe: false,
    safe: false,
    default: false,
    abi: null,
    name: "__fragment",
    generics: { kind: "Generics", params: [], where: [], start: 0, end: 0 },
    params: [],
    variadic: false,
    ret: null,
    body: block,
    start: 0,
    end: source.length,
  };
  file.items.push(fn);
  return new RustFile(source, options.path, file, comments);
}

// Compact s-expression rendering of AST nodes, for tests and for looking at
// what the parser produced:
//
//   bun scripts/rust-parser/debug.ts expr 'a + b * c'      prints (+ a (* b c))
//   bun scripts/rust-parser/debug.ts type 'Box<dyn Fn()>'
//   bun scripts/rust-parser/debug.ts pat 'Some(x) | None'
//   bun scripts/rust-parser/debug.ts stmts 'let x = 1; x'
//   bun scripts/rust-parser/debug.ts file path/to/file.rs
//
// The rendering is lossy on purpose (no spans, no attributes on expressions,
// no function qualifiers). It exists to make tests readable, not to round-trip.

import { parseRust, parseRustExpr, parseRustFragment, parseRustPat, parseRustType } from "./index.ts";

export function sexpr(input: unknown): string {
  // Untyped on purpose: the printer reads a field or two per kind and has a
  // default arm for kinds it does not know.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node = input as any;
  if (node === null || node === undefined) return "_";
  if (Array.isArray(node)) return "[" + node.map(n => sexpr(n)).join(" ") + "]";
  if (typeof node !== "object") return JSON.stringify(node);
  const k = node.kind;
  switch (k) {
    case "Lit":
      return node.text;
    case "PathExpr":
    case "TypePath":
    case "PatPath":
      return sexpr(node.path);
    case "Path": {
      let s = node.segments.map((seg: any) => seg.name + (seg.args ? sexpr(seg.args) : "")).join("::");
      if (node.global) s = "::" + s;
      if (node.qself) s = `<${sexpr(node.qself)}${node.asTrait ? " as " + sexpr(node.asTrait) : ""}>::` + s;
      return s;
    }
    case "AngleArgs":
      return (node.turbofish ? "::" : "") + "<" + node.args.map((a: any) => sexpr(a)).join(",") + ">";
    case "ParenArgs":
      return (
        "(" + node.inputs.map((a: any) => sexpr(a)).join(",") + ")" + (node.output ? "->" + sexpr(node.output) : "")
      );
    case "Lifetime":
      return node.name;
    case "PatIdent":
      return (
        (node.byRef ? "ref " : "") + (node.mutable ? "mut " : "") + node.name + (node.sub ? "@" + sexpr(node.sub) : "")
      );
    case "PatWild":
      return "_";
    case "PatRest":
      return "..";
    case "Infer":
      return "_";
    case "Binary":
      return `(${node.op} ${sexpr(node.left)} ${sexpr(node.right)})`;
    case "Unary":
      return `(${node.op} ${sexpr(node.expr)})`;
    case "Ref":
      return `(&${node.raw ? (node.mutable ? "raw mut " : "raw const ") : node.mutable ? "mut " : ""}${sexpr(node.expr)})`;
    case "Cast":
      return `(as ${sexpr(node.expr)} ${sexpr(node.ty)})`;
    case "Call":
      return `(call ${sexpr(node.callee)} ${sexpr(node.args)})`;
    case "MethodCall":
      return `(.${node.method}${node.turbofish ? sexpr(node.turbofish) : ""} ${sexpr(node.receiver)} ${sexpr(node.args)})`;
    case "Field":
      return `(.${node.member} ${sexpr(node.expr)})`;
    case "Index":
      return `(index ${sexpr(node.expr)} ${sexpr(node.index)})`;
    case "Try":
      return `(? ${sexpr(node.expr)})`;
    case "Await":
      return `(await ${sexpr(node.expr)})`;
    case "Paren":
      return `(paren ${sexpr(node.expr)})`;
    case "Tuple":
      return `(tuple ${sexpr(node.elems)})`;
    case "Array":
      return `(array ${sexpr(node.elems)})`;
    case "Repeat":
      return `(repeat ${sexpr(node.elem)} ${sexpr(node.len)})`;
    case "Range":
      return `(range${node.inclusive ? "=" : ""} ${sexpr(node.lo)} ${sexpr(node.hi)})`;
    case "Assign":
      return `(= ${sexpr(node.left)} ${sexpr(node.right)})`;
    case "AssignOp":
      return `(${node.op} ${sexpr(node.left)} ${sexpr(node.right)})`;
    case "Macro":
      return `(macro ${sexpr(node.path)}!${node.delim} ${sexpr(node.args)})`;
    case "Closure":
      return `(closure${node.move ? " move" : ""}${node.async ? " async" : ""} ${sexpr(node.params)}${node.ret ? " -> " + sexpr(node.ret) : ""} ${sexpr(node.body)})`;
    case "ClosureParam":
      return sexpr(node.pat) + (node.ty ? ":" + sexpr(node.ty) : "");
    case "Block":
      return `{${node.stmts.map((s: any) => sexpr(s)).join(" ")}}`;
    case "BlockExpr":
      return (node.label ? node.label + ": " : "") + sexpr(node.block);
    case "Unsafe":
      return `(unsafe ${sexpr(node.block)})`;
    case "Async":
      return `(async${node.move ? " move" : ""} ${sexpr(node.block)})`;
    case "ConstBlock":
      return `(const ${sexpr(node.block)})`;
    case "ExprStmt":
      return sexpr(node.expr) + (node.semi ? ";" : "");
    case "Local":
      return `(let ${sexpr(node.pat)}${node.ty ? ":" + sexpr(node.ty) : ""}${node.init ? " = " + sexpr(node.init) : ""}${node.else ? " else " + sexpr(node.else) : ""})`;
    case "Empty":
      return ";";
    case "If":
      return `(if ${sexpr(node.cond)} ${sexpr(node.then)}${node.else ? " else " + sexpr(node.else) : ""})`;
    case "Let":
      return `(let ${sexpr(node.pat)} = ${sexpr(node.expr)})`;
    case "Match":
      return `(match ${sexpr(node.expr)} ${sexpr(node.arms)})`;
    case "MatchArm":
      return `(arm ${sexpr(node.pat)}${node.guard ? " if " + sexpr(node.guard) : ""} => ${sexpr(node.body)})`;
    case "While":
      return `(while${node.label ? " " + node.label : ""} ${sexpr(node.cond)} ${sexpr(node.body)})`;
    case "Loop":
      return `(loop${node.label ? " " + node.label : ""} ${sexpr(node.body)})`;
    case "ForLoop":
      return `(for${node.label ? " " + node.label : ""} ${sexpr(node.pat)} in ${sexpr(node.expr)} ${sexpr(node.body)})`;
    case "Return":
      return `(return ${sexpr(node.expr)})`;
    case "Break":
      return `(break${node.label ? " " + node.label : ""} ${sexpr(node.expr)})`;
    case "Continue":
      return `(continue${node.label ? " " + node.label : ""})`;
    case "StructExpr":
      return `(struct ${sexpr(node.path)} ${sexpr(node.fields)}${node.hasRest ? " .." + sexpr(node.rest) : ""})`;
    case "FieldValue":
      return node.member + (node.shorthand ? "" : ":" + sexpr(node.expr));
    case "TypeRef":
      return `&${node.lifetime ? node.lifetime.name + " " : ""}${node.mutable ? "mut " : ""}${sexpr(node.elem)}`;
    case "TypePtr":
      return `*${node.mutable ? "mut" : "const"} ${sexpr(node.elem)}`;
    case "TypeSlice":
      return `[${sexpr(node.elem)}]`;
    case "TypeArray":
      return `[${sexpr(node.elem)}; ${sexpr(node.len)}]`;
    case "TypeTuple":
      return `(${node.elems.map((e: any) => sexpr(e)).join(",")})`;
    case "TypeParen":
      return `(paren ${sexpr(node.elem)})`;
    case "TypeNever":
      return "!";
    case "TypeInfer":
      return "_";
    case "TypeBareFn":
      return `${node.forLifetimes.length ? "for<" + node.forLifetimes.map((l: any) => l.name).join(",") + "> " : ""}${node.unsafe ? "unsafe " : ""}${node.abi !== null ? `extern "${node.abi}" ` : ""}fn(${node.params.map((p: any) => (p.name ? p.name + ":" : "") + sexpr(p.ty)).join(",")}${node.variadic ? ",..." : ""})${node.ret ? "->" + sexpr(node.ret) : ""}`;
    case "TypeTraitObject":
      return `${node.dyn ? "dyn " : ""}${node.bounds.map((b: any) => sexpr(b)).join("+")}`;
    case "TypeImplTrait":
      return `impl ${node.bounds.map((b: any) => sexpr(b)).join("+")}`;
    case "TraitBound":
      return `${node.maybe ? "?" : ""}${node.constness ? node.constness + " " : ""}${node.forLifetimes.length ? "for<" + node.forLifetimes.map((l: any) => l.name).join(",") + "> " : ""}${sexpr(node.path)}`;
    case "UseBound":
      return `use<${node.args.join(",")}>`;
    case "ConstArg":
      return `{${sexpr(node.expr)}}`;
    case "AssocBinding":
      return `${node.name}${node.args ? sexpr(node.args) : ""}=${sexpr(node.ty ?? node.value)}`;
    case "AssocConstraint":
      return `${node.name}:${node.bounds.map((b: any) => sexpr(b)).join("+")}`;
    case "PatLit":
      return sexpr(node.expr);
    case "PatRange":
      return `(prange${node.inclusive ? "=" : ""} ${sexpr(node.lo)} ${sexpr(node.hi)})`;
    case "PatRef":
      return `(&${node.mutable ? "mut " : ""}${sexpr(node.pat)})`;
    case "PatTuple":
      return `(ptuple ${sexpr(node.elems)})`;
    case "PatSlice":
      return `(pslice ${sexpr(node.elems)})`;
    case "PatTupleStruct":
      return `(${sexpr(node.path)} ${sexpr(node.elems)})`;
    case "PatStruct":
      return `(${sexpr(node.path)} {${node.fields.map((f: any) => sexpr(f)).join(" ")}${node.rest ? " .." : ""}})`;
    case "FieldPat":
      return node.member + (node.shorthand ? "" : ":" + sexpr(node.pat));
    case "PatOr":
      return `(| ${sexpr(node.alts)})`;
    case "PatParen":
      return `(pparen ${sexpr(node.pat)})`;
    case "PatConst":
      return `(pconst ${sexpr(node.block)})`;
    case "PatBox":
      return `(box ${sexpr(node.pat)})`;
    case "Fn":
      return `(fn ${node.name}${sexpr(node.generics)} ${sexpr(node.params)}${node.ret ? " -> " + sexpr(node.ret) : ""} ${node.body ? sexpr(node.body) : ";"})`;
    case "Receiver":
      return `(self${node.ref ? " &" : ""}${node.lifetime ? node.lifetime.name : ""}${node.mutable ? " mut" : ""}${node.ty ? ":" + sexpr(node.ty) : ""})`;
    case "Param":
      return `${node.pat ? sexpr(node.pat) : "_"}:${sexpr(node.ty)}`;
    case "Generics":
      return node.params.length || node.where.length
        ? `<${node.params.map((p: any) => sexpr(p)).join(",")}>${node.where.length ? " where " + node.where.map((w: any) => sexpr(w)).join(",") : ""}`
        : "";
    case "TypeParam":
      return `${node.name}${node.bounds.length ? ":" + node.bounds.map((b: any) => sexpr(b)).join("+") : ""}${node.default ? "=" + sexpr(node.default) : ""}`;
    case "LifetimeParam":
      return node.name + (node.bounds.length ? ":" + node.bounds.map((b: any) => b.name).join("+") : "");
    case "ConstParam":
      return `const ${node.name}:${sexpr(node.ty)}${node.default ? "=" + sexpr(node.default) : ""}`;
    case "WhereType":
      return `${sexpr(node.ty)}:${node.bounds.map((b: any) => sexpr(b)).join("+")}`;
    case "WhereLifetime":
      return `${node.lifetime.name}:${node.bounds.map((b: any) => b.name).join("+")}`;
    case "Struct":
      return `(struct ${node.name}${sexpr(node.generics)} ${node.fields ? sexpr(node.fields) : "unit"})`;
    case "StructField":
      return `${node.vis ? node.vis + " " : ""}${node.name ?? ""}:${sexpr(node.ty)}`;
    case "Enum":
      return `(enum ${node.name} ${sexpr(node.variants)})`;
    case "Variant":
      return `${node.name}${node.fields ? sexpr(node.fields) : ""}${node.discriminant ? "=" + sexpr(node.discriminant) : ""}`;
    case "Impl":
      return `(impl${sexpr(node.generics)}${node.unsafe ? " unsafe" : ""}${node.negative ? " !" : ""} ${node.trait ? sexpr(node.trait) + " for " : ""}${sexpr(node.selfTy)} ${sexpr(node.items)})`;
    case "Trait":
      return `(trait ${node.name}${sexpr(node.generics)}${node.supertraits.length ? ": " + node.supertraits.map((b: any) => sexpr(b)).join("+") : ""} ${sexpr(node.items)})`;
    case "Attribute":
      return `#${node.style === "inner" ? "!" : ""}[${sexpr(node.meta)}]`;
    case "MetaPath":
      return node.path;
    case "MetaList":
      return `${node.path}(${node.items.map((i: any) => sexpr(i)).join(", ")})`;
    case "MetaNameValue":
      return `${node.path} = ${node.value}`;
    case "MetaTokens":
      return `tokens(${node.tokens.length})`;
    case "Use":
      return `(use ${node.global ? "::" : ""}${sexpr(node.tree)})`;
    case "UsePath":
      return `${node.name}::${sexpr(node.tree)}`;
    case "UseName":
      return node.name;
    case "UseRename":
      return `${node.name} as ${node.rename}`;
    case "UseGlob":
      return "*";
    case "UseGroup":
      return `{${node.items.map((i: any) => sexpr(i)).join(", ")}}`;
    case "Const":
      return `(const ${node.name}${node.ty ? ":" + sexpr(node.ty) : ""}${node.expr ? " = " + sexpr(node.expr) : ""})`;
    case "Static":
      return `(static${node.mutable ? " mut" : ""} ${node.name}:${sexpr(node.ty)}${node.expr ? " = " + sexpr(node.expr) : ""})`;
    case "TypeAlias":
      return `(type ${node.name}${sexpr(node.generics)}${node.bounds.length ? ":" + node.bounds.map((b: any) => sexpr(b)).join("+") : ""}${node.ty ? " = " + sexpr(node.ty) : ""})`;
    case "Mod":
      return `(mod ${node.name} ${node.items ? sexpr(node.items) : ";"})`;
    case "ForeignMod":
      return `(extern${node.unsafe ? " unsafe" : ""} "${node.abi}" ${sexpr(node.items)})`;
    case "ExternCrate":
      return `(extern crate ${node.name}${node.rename ? " as " + node.rename : ""})`;
    case "MacroRules":
      return `(macro_rules ${node.name})`;
    case "Union":
      return `(union ${node.name} ${sexpr(node.fields)})`;
    case "File":
      return sexpr(node.items);
    default:
      return `<${k}>`;
  }
}

if (import.meta.main) {
  const [mode, input] = process.argv.slice(2);
  if (input === undefined) {
    console.error("usage: bun scripts/rust-parser/debug.ts <expr|type|pat|stmts|file> <input>");
    process.exit(1);
  }
  if (mode === "expr") console.log(sexpr(parseRustExpr(input)));
  else if (mode === "type") console.log(sexpr(parseRustType(input)));
  else if (mode === "pat") console.log(sexpr(parseRustPat(input)));
  else if (mode === "stmts") console.log(sexpr((parseRustFragment(input).items[0] as { body: unknown }).body));
  else if (mode === "file") console.log(sexpr(parseRust(await Bun.file(input).text(), input).ast));
  else {
    console.error("usage: bun scripts/rust-parser/debug.ts <expr|type|pat|stmts|file> <input>");
    process.exit(1);
  }
}

interface Num { kind: "num"; value: number }
interface Add { kind: "add"; left: Expr; right: Expr }
interface Neg { kind: "neg"; inner: Expr }
interface Mul { kind: "mul"; left: Expr; right: Expr; scale: number }
type Expr = Num | Add | Neg | Mul;
const num = (value: number): Expr => ({ kind: "num", value });
const add = (left: Expr, right: Expr): Expr => ({ kind: "add", left, right });
const neg = (inner: Expr): Expr => ({ kind: "neg", inner });
const mul = (left: Expr, right: Expr): Expr => ({ kind: "mul", left, right, scale: 1 });
const tree = (depth: number): Expr => depth <= 0 ? num(depth + 3) : depth % 3 == 0 ? neg(tree(depth - 1)) : depth % 3 == 1 ? add(tree(depth - 1), num(depth)) : mul(num(2), tree(depth - 2));
function value(e: Expr): number { if (e.kind === "num") return e.value; if (e.kind === "neg") return -value(e.inner); if (e.kind === "add") return value(e.left) + value(e.right); return value(e.left) * value(e.right); }
function name(e: Expr): string { switch (e.kind) { case "num": return "n"; case "neg": return "-" + name(e.inner); default: return name(e.left) + e.kind + name(e.right); } }
let out = ""; for (let i = 0; i < 4; i++) out += value({ kind: "num", value: i }) + value({ kind: "neg", inner: { kind: "num", value: i } }) + value({ kind: "add", left: { kind: "num", value: i }, right: { kind: "mul", left: { kind: "num", value: 2 }, right: { kind: "num", value: i }, scale: 1 } }) + name({ kind: "neg", inner: { kind: "add", left: { kind: "num", value: 1 }, right: { kind: "num", value: 2 } } }) + " "; console.log(out);

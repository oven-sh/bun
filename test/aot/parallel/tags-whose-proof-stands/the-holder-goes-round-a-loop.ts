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
function leftmost(e: Expr): number { while (e.kind !== "num") { if (e.kind === "neg") e = e.inner; else e = e.left; } return e.value; }
function depth(e: Expr): number { let n = 0; for (;;) { if (e.kind === "num") return n; n++; if (e.kind === "add") { e = e.left; continue; } if (e.kind === "mul") { e = e.right; continue; } e = e.inner; } }
let out = ""; for (let d = 0; d < 9; d++) out += leftmost(tree(d)) + ":" + depth(tree(d)) + " "; console.log(out);

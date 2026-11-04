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
let closed = 0;
function guarded(e: Expr): number { try { if (e.kind === "num") { if (e.value > 4) throw new RangeError("large"); return e.value; } if (e.kind === "neg") return -guarded(e.inner); try { if (e.kind === "add") return guarded(e.left) + guarded(e.right); return guarded(e.left) * guarded(e.right); } finally { closed++; } } catch (error) { return e.kind === "num" ? 100 + e.value : e.kind === "neg" ? -1 : -2; } }
let out = ""; for (let d = 0; d < 9; d++) out += guarded(tree(d)) + " "; console.log(out, closed);

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
function maybe(e: Expr | undefined): string { if (e?.kind === "num") return "n" + e.value; if (e === undefined) return "u"; if (e.kind === "neg") return "g" + maybe(e.inner); return e.kind + maybe(e.left); }
function orNull(e: Expr | null): string { if (e && e.kind === "add") return "a" + orNull(e.right); if (e !== null && e.kind === "num") return "n"; return e ? e.kind : "null"; }
let out = ""; for (let d = 0; d < 9; d++) out += maybe(d % 4 == 3 ? undefined : tree(d)) + ":" + orNull(d % 3 == 2 ? null : tree(d)) + " "; console.log(out);

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
function* leaves(e: Expr): Generator<number> { if (e.kind === "num") { yield e.value; return; } if (e.kind === "neg") { yield -1; yield* leaves(e.inner); return; } yield* leaves(e.left); yield e.kind === "add" ? 0 : 1; yield* leaves(e.right); }
async function total(e: Expr): Promise<number> { if (e.kind === "num") { await null; return e.value; } if (e.kind === "neg") { const inner = await total(e.inner); return -inner; } const left = await total(e.left); await null; const right = await total(e.right); return e.kind === "add" ? left + right : left * right; }
let out = ""; for (let d = 0; d < 7; d++) out += [...leaves(tree(d))].join("") + ":" + (await total(tree(d))) + " "; console.log(out);

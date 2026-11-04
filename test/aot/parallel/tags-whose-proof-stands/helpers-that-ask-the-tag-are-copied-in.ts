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
const isNum = (e: Expr): e is Num => e.kind === "num";
const isPair = (e: Expr): e is Add | Mul => e.kind === "add" || e.kind === "mul";
function kindOf(e: Expr): string { return e.kind; }
function total(e: Expr): number { if (isNum(e)) return e.value; if (isPair(e)) return kindOf(e) === "add" ? total(e.left) + total(e.right) : total(e.left) * total(e.right); return -total(e.inner); }
let out = ""; for (let d = 0; d < 9; d++) out += total(tree(d)) + " "; console.log(out);

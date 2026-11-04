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
function kept(e: Expr): string { const isNum = e.kind === "num", isNeg = e.kind === "neg"; let out = ""; if (isNum) out += "n"; if (isNeg) out += "g"; if (!isNum && !isNeg) out += e.kind; return out + (isNum ? 1 : 0) + String(isNeg); }
function handedOn(e: Expr): boolean[] { return [e.kind === "num", e.kind !== "add", "mul" === e.kind]; }
let out = ""; for (let d = 0; d < 9; d++) out += kept(tree(d)) + ":" + handedOn(tree(d)).join("") + " "; console.log(out);

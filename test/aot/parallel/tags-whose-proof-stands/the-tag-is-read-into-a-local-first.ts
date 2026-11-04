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
function byLocal(e: Expr): number { const kind = e.kind; if (kind === "num") return (e as Num).value; if (kind === "neg") return -byLocal((e as Neg).inner); const pair = e as Add | Mul; return kind === "add" ? byLocal(pair.left) + byLocal(pair.right) : byLocal(pair.left) * byLocal(pair.right); }
function byPattern(e: Expr): string { const { kind } = e; switch (kind) { case "num": return "n"; case "neg": return "g"; default: return kind; } }
let out = ""; for (let d = 0; d < 9; d++) out += byLocal(tree(d)) + byPattern(tree(d)) + " "; console.log(out);

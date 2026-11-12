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
function walk(e: Expr): string { let path = ""; for (let steps = 0; steps < 40; steps++) { switch (e.kind) { case "num": return path + e.value; case "neg": path += "-"; e = e.inner; break; case "add": path += "+"; e = e.right.kind === "num" ? e.left : e.right; break; case "mul": path += "*"; e = e.right; break; } } return path; }
let out = ""; for (let d = 0; d < 9; d++) out += walk(tree(d)) + " "; console.log(out);

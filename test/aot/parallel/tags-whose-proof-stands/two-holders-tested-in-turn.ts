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
function same(a: Expr, b: Expr): boolean { if (a.kind === "num") return b.kind === "num" && a.value === b.value; if (b.kind === "num") return false; if (a.kind === "neg") return b.kind === "neg" && same(a.inner, b.inner); if (b.kind === "neg") return false; return a.kind === b.kind && same(a.left, b.left) && same(a.right, b.right); }
function pick(a: Expr, b: Expr): string { switch (a.kind) { case "num": switch (b.kind) { case "num": return "nn" + (a.value + b.value); case "neg": return "ng"; default: return "n" + b.kind; } case "neg": return b.kind === "neg" ? "gg" : "g" + b.kind; default: return a.kind + b.kind; } }
let out = ""; for (let d = 0; d < 7; d++) for (let c = 0; c < 7; c += 2) out += (same(tree(d), tree(c)) ? "y" : "n") + pick(tree(d), tree(c)) + " "; console.log(out);

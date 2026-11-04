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
function byRow(e: Expr): number { if (e.kind === "num") return e.value; if (e.kind === "add") return byRow(e.left) + byRow(e.right); if (e.kind === "mul") return byRow(e.left) * byRow(e.right); return -byRow(e.inner); }
function bySwitch(e: Expr): number { switch (e.kind) { case "num": return e.value; case "add": return bySwitch(e.left) + bySwitch(e.right); case "mul": return bySwitch(e.left) * bySwitch(e.right); case "neg": return -bySwitch(e.inner); } }
function pairs(e: Expr): number { if (e.kind === "add" || e.kind === "mul") return 1 + pairs(e.left) + pairs(e.right); if (e.kind === "neg") return pairs(e.inner); return 0; }
function notPairs(e: Expr): number { if (e.kind !== "add" && e.kind !== "mul") return e.kind === "neg" ? notPairs(e.inner) : 1; return notPairs(e.left) + notPairs(e.right); }
let out = ""; for (let d = 0; d < 9; d++) out += byRow(tree(d)) + ":" + bySwitch(tree(d)) + ":" + pairs(tree(d)) + ":" + notPairs(tree(d)) + " "; console.log(out);

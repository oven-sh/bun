// One number is an operand of several bit operators: ahead of a loop and in it, on one arm of a branch and behind the join, under a handler, as both operands. Each use converts as ToInt32 | ToUint32 says.
const launder = new Function("v", "return v" + String(process.argv[9] ?? "").slice(99)) as <V>(v: V) => V;
type Node = { bits: number; parent: Node | null };
function chain(depth: number): Node { let node: Node = launder({ bits: 0, parent: null }); for (let i = 0; i < depth; i++) node = launder({ bits: i, parent: node }); return node; }
function mark(leaf: Node, lane: number): number {
    leaf.bits |= lane;
    let seen = 0;
    for (let node = leaf.parent; node !== null; node = node.parent) { node.bits |= lane; seen ^= node.bits & lane; }
    return seen;
}
function onOneArm(flag: boolean, n: number): number { let r = 1; if (flag) r = n | 4; return (r ^ n) + (n & 7); }
function onBothArms(flag: boolean, n: number): number { const r = flag ? n << 1 : n >> 1; return r + (n >>> 0) + (n >>> 28); }
function underHandler(n: number, fail: boolean): number { let r = 0; try { r = n | 1; if (fail) throw new Error("thrown"); r += n & 3; } catch { r += n ^ 5; } finally { r += ~n; } return r + (n | 0); }
function bothOperands(n: number): number { return (n | n) + (n & n) + (n ^ n) + (n << n) + (n >> n) + (n >>> n); }
function inSecondLoop(n: number, turns: number): number { let r = 0; for (let i = 0; i < turns; i++) { if (i & 1) r += n | i; } for (let i = 0; i < turns; i++) r ^= n & i; return r; }
function boxed(values: number[], n: number): number { let r = 0; for (const value of values) r += (value | n) ^ (value & n); return r + (values[0] | 0) + (values[0] >>> 0); }
const numbers: number[] = [0, -0, 1, -1, 0.5, -0.5, 1.9, -1.9, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 31 - 1, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 32 + 1, -(2 ** 32) - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 63, 2 ** 64 + 2 ** 12,
    -(2 ** 63), 1e21, -1e21, 1e300, Number.MAX_VALUE, Number.MIN_VALUE, 4294967297.5, 123456789012345];
for (let round = 0; round < 3; round++) {
    for (const number of numbers) {
        const n = launder(number);
        console.log(String(number), mark(chain(5), n), onOneArm(true, n), onOneArm(false, n), onBothArms(true, n), onBothArms(false, n), underHandler(n, false), underHandler(n, true), bothOperands(n), inSecondLoop(n, 5),
            boxed(launder([n, 1.5, 7]), n));
    }
}

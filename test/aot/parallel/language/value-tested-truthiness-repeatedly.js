// Every kind of value is tested for truthiness several times in one function: behind a call that changes what the value refers to, behind a merge point, in a loop, across an await and a yield, and in a handler.
const kinds = [0, -0, 1, NaN, 2.5, "", "a", null, undefined, true, false, {}, [], 0n, 1n, Symbol("s"), () => 0, new String(""), new Number(0), new Boolean(false), "x".repeat(3) + "y", "".concat("")];
const log = [];
function grow(x) { if (x && typeof x === "object") x.grown = (x.grown ?? 0) + 1; return 1; }
function behindCall(x) { let n = 0; if (x) n += 1; n += grow(x); if (x) n += 2; return n; }
function behindAnd(x) { return x && x.grown ? (x ? 1 : 2) : (x ? 3 : 4); }
function inLoop(x) { let n = 0; for (let i = 0; i < 5; i++) { if (x) n += i; else n -= i; } return n; }
function reassigned(x, y) { let n = x ? 1 : 0; x = y; if (x) n += 2; return n; }
function negated(x) { const a = !x, b = !!x; return (a ? 1 : 0) + (b ? 2 : 0) + (x ? 4 : 0) + (!x ? 8 : 0); }
function inHandler(x) { try { if (x) throw x; return 0; } catch (e) { return (e ? 1 : 2) + (x ? 4 : 8); } finally { if (x) log.push("finally"); } }
async function acrossAwait(x) { const a = x ? 1 : 0; await null; return a + (x ? 2 : 0); }
function* acrossYield(x) { yield x ? 1 : 0; yield x ? 2 : 0; }
for (let i = 0; i < kinds.length; i++) {
    const x = kinds[i], y = kinds[(i * 5 + 3) % kinds.length];
    log.push([i, behindCall(x), behindAnd(x), inLoop(x), reassigned(x, y), negated(x), inHandler(x), [...acrossYield(x)].join("")].join(" "));
}
log.push((await Promise.all(kinds.map(acrossAwait))).join(""));
console.log(log.join("\n"));

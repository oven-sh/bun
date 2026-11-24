// The string of an integer that sums have made before is found again: a year in front of its hyphen enters the run time once.
// COUNTER: operationAOTValueAdd <= 8000
const log = [];
const id = v => [v][0];
const hide = v => JSON.parse("0", () => v);
function before(n) { return hide(n) + "-"; }
function behind(n) { return "#" + hide(n); }
function alone(n) { return "" + hide(n); }
function both(n, m) { return hide(n) + "x" + hide(m); }
Object.assign(globalThis, { before, behind, alone, both });
const functions = hide([globalThis.before, globalThis.behind, globalThis.alone, globalThis.both]);
const numbers = [0, 9, 10, 1023, 1024, 2007, 2008, 65536, 2147483647, -1, -2007, -2147483648];
let length = 0;
for (let turn = 0; turn < 400; turn++)
    for (const f of functions) for (const n of numbers) { const s = f(n, 2007 + (turn & 3)); length += s.length; if (turn % 100 === 7) log.push(s); }
const others = [1.5, -0, NaN, 1e21, 4294967296, 2147483648, null, undefined, true, id("ab"), id("a") + id("b"), new String("wrapped"), ["l", 1], { toString: () => "own" }, { valueOf: () => 7 }, 10n, new Date(NaN)];
for (const f of functions) for (const n of others) for (const m of [1, "s", 2007]) log.push(f(n, m));
for (const f of functions) try { log.push(f(Symbol("s"), 1)); } catch (e) { log.push(e.name); }
const changed = new String("changed"); changed.valueOf = () => 12345; log.push(before(changed), behind(changed), alone(changed));
console.log(length, log.join("\n"));

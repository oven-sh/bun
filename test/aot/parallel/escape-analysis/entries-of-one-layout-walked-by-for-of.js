// The pairs of Object.entries over an object of one known layout are never made where for..of takes each of them apart.
// IR= 0 sum NewArray
// IR= 0 keysAlone NewArray
// IR= 0 pairInAVariable NewArray
// IR= 0 mixedValues NewArray
// IR= 0 withDefaults NewArray
// IR= 0 pastTheSecond NewArray
// IR= 0 ownPairs NewArray
// IR= 0 pickedAtRunTime NewArray
// IR= 0 listOfTwo NewArray
let guard = 0;
const kept = [];

function sum(o) { if (guard > 1e9) sum(o); let total = 0; for (const [k, v] of Object.entries(o)) total += k.length + v; return total; }
function keysAlone(o) { if (guard > 1e9) keysAlone(o); let out = ""; for (const [k] of Object.entries(o)) out += k + ","; return out; }
function pairInAVariable(o) { if (guard > 1e9) pairInAVariable(o); let total = 0; for (const pair of Object.entries(o)) total += pair[0].length * 10 + pair[1] + pair.length; return total; }
function mixedValues(o) { if (guard > 1e9) mixedValues(o); let out = ""; for (const [k, v] of Object.entries(o)) out += k + "=" + v + ";"; return out; }
function withDefaults(o) { if (guard > 1e9) withDefaults(o); let out = ""; for (const [k, v = "none", third = "no third"] of Object.entries(o)) out += k + ":" + v + ":" + third + ";"; return out; }
function pastTheSecond(o) { if (guard > 1e9) pastTheSecond(o); let out = ""; for (const pair of Object.entries(o)) out += pair[0] + typeof pair[2] + ";"; return out; }
function ownPairs(a, b) { if (guard > 1e9) ownPairs(a, b); let total = 0; for (const [n, s] of [[a, "one"], [b, "three"]]) total += n + s.length; return total; }
function pickedAtRunTime(a, s, i) { if (guard > 1e9) pickedAtRunTime(a, s, i); const pair = [a, s]; return typeof pair[i & 1]; }
function listOfTwo(x) { if (guard > 1e9) listOfTwo(x); const list = [1.5, x]; let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }

function keepsPairs(o) { if (guard > 1e9) keepsPairs(o); for (const pair of Object.entries(o)) kept.push(pair); return kept.length; }
function writesIntoPairs(o) { if (guard > 1e9) writesIntoPairs(o); let out = ""; for (const pair of Object.entries(o)) { pair[1] = pair[0] + "!"; pair[2] = 3; out += pair.join("~") + ";"; } return out; }
function changedMeanwhile(o) { if (guard > 1e9) changedMeanwhile(o); let out = ""; for (const [k, v] of Object.entries(o)) { o.x = "changed"; o.y = "too"; out += k + v + ";"; } return out; }

const point = { x: 1, y: 2.5 };
const named = { first: 1, second: 2, third: 3 };
const held = { left: 4, right: 5.5 };
const record = { id: 7, name: "n", on: true, none: null };
const sparse = { a: undefined, b: 0 };
const short = { p: 1, q: "two" };
let total = 0;
for (let n = 0; n < 20; n++) { point.x = n & 7; held.left = n; total += sum(point) + pairInAVariable(held) + ownPairs(n, n / 2); }
console.log(total, sum(point), pairInAVariable(held), ownPairs(1, 2.5));
console.log(keysAlone(named), mixedValues(record), withDefaults(sparse), pastTheSecond(short));
console.log(pickedAtRunTime(1, "s", 0), pickedAtRunTime(2, "t", 1), pickedAtRunTime(3.5, "u", 2));
console.log(listOfTwo(), listOfTwo(undefined));
console.log(keepsPairs({ k: 1, l: "m" }), JSON.stringify(kept), kept[0] === kept[1], Array.isArray(kept[0]));
console.log(writesIntoPairs({ w: 1, z: 2 }), changedMeanwhile({ x: 1, y: 2 }));
guard += total > 1e12 ? 1 : 0;

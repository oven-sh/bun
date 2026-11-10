// `[...map]` in every company: empty, small, large, behind other elements, with deleted entries, with keys of every kind, with an iterator of its own, and what the pairs are
const show = list => list.map(pair => Array.isArray(pair) ? "[" + pair.map(String).join("=") + "]#" + pair.length : String(pair)).join(" ");
const small = new Map([["a", 1], ["b", { toString() { return "obj"; } }], [3, "three"], [null, undefined], [NaN, -0]]);
console.log(show([...small]));
console.log(show([...new Map()]), [...new Map()].length);
console.log(show(["head", ...small, "middle", ...small, "tail"]));
const large = new Map(); for (let i = 0; i < 300; i++) large.set("k" + i, i);
for (let i = 0; i < 300; i += 3) large.delete("k" + i);
const spread = [...large];
console.log(spread.length, show(spread.slice(0, 3)), show(spread.slice(-2)));
const pairs = [...small];
pairs[0][0] = "changed"; pairs[0].push("more");
console.log(show(pairs.slice(0, 1)), show([...small].slice(0, 1)), pairs[1] !== [...small][1]);
function many(map, turns) { let n = 0; for (let t = 0; t < turns; t++) for (const [k, v] of [...map]) n += String(k).length + (v ? 1 : 0); return n; }
console.log(many(small, 200), many(large, 20));
const numbers = [1, 2, ...new Map([[1, 2]])];
console.log(show(numbers));
class Sub extends Map { *[Symbol.iterator]() { yield "own"; } }
console.log(show([...new Sub([["x", 1]])]));
const own = new Map([["x", 1]]); own[Symbol.iterator] = function* () { yield "mine"; };
console.log(show([...own]));

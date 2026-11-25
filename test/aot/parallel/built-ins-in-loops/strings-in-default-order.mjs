// sort() and toSorted() of strings in the default order: equal beginnings, short and long ones, NUL, Latin-1, two-byte strings, ropes, duplicates that are other strings, holes and other values, written lists.
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
function slowly(list) { const l = list.map(String); for (let i = 1; i < l.length; i++) for (let j = i; j > 0 && l[j] < l[j - 1]; j--) [l[j], l[j - 1]] = [l[j - 1], l[j]]; return l; }
let seed = 12345; const random = n => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) % n;
const alphabets = ["ab", "a\0", "0123456789", "abcdefghijklmnopqrstuvwxyz", "aÿé", "ab中\u{1F600}", "item_0000_xy"];
function make(alphabet, most) { const n = random(most + 1); let s = ""; for (let i = 0; i < n; i++) s += alphabet[random(alphabet.length)]; return s; }
let hash = 0, bad = 0; const mix = s => { for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0; };
for (const alphabet of alphabets) for (const most of [0, 1, 3, 4, 7, 8, 9, 16, 20]) for (let k = 0; k < 12; k++) { const l = Array.from({ length: random(70) }, () => (random(3) ? "" : "prefix__") + make(alphabet, most)); const expected = slowly(l), copy = [...l], sorted = l.toSorted(); const result = copy.sort(); if (result !== copy || !same(copy, expected) || !same(sorted, expected)) { bad++; console.log("wrong", JSON.stringify(l)); } mix(copy.join()); copy.sort(); mix(copy.join()); copy.reverse().sort(); mix(copy.join()); if (!same(copy, expected)) bad++; }
console.log(bad, hash);
const a = "ke" + "y".repeat(3), b = ["k", "eyyy"].join(""), holder = [b, a, "key", "", a, b]; holder.sort(); console.log(holder.join("|"));
console.log(["b", , "a", undefined, "c"].sort(), [3, "20", 100, "3", true, null].sort().map(String).join(), [["b"], ["a", 1]].sort().join(";"), ["b", "a", { toString() { return "aa"; } }].sort().map(String).join());
console.log(["delta", "alpha", "charlie", "bravo"].sort().join(), Object.keys({ zeta: 1, eta: 2, theta: 3, 10: 4, 9: 5 }).sort().join(), [..."hello world"].sort().join(""), "the quick brown fox jumps over the lazy dog".split(" ").sort().join(" "));
function written(k) { const l = ["pear", "apple", "fig", "applesauce", "app", "banana", "apple"]; if (k & 1) l.push("aa" + k); return l.sort().join(); } let s = ""; for (let k = 0; k < 300; k++) s = written(k) + s.length; console.log(s);
try { Object.freeze(["b", "a"]).sort(); } catch (error) { console.log(error.name); } console.log(Object.freeze(["a", "b"]).toSorted().join(), ["only"].sort().join(), [].sort().length, ["x".repeat(100) + "b", "x".repeat(100) + "a"].sort().map(t => t.at(-1)).join(""));
try { ["a", Symbol("s"), "b"].sort(); } catch (error) { console.log(error.name); }

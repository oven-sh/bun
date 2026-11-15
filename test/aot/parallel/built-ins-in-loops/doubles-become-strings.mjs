// String() of doubles, integers, immediates and unknown values in loops: values met again, more of them than are kept, zeros of both signs, NaN, infinities, collections between.
const doubles = [1.5, 22.25, 0.1, 1234.5678, 1e21, -3.75, 0.001, 99.99, -0, 0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308, 123456789012345680000, 2 ** 53, -1e-7, 4294967296.5, 1 / 3];
function strings(list, turns) { let n = 0; const seen = new Set(); for (let k = 0; k < turns; k++) { const s = String(list[k % list.length]); n += s.length; if (k < 3 * list.length) seen.add(s); } return n + [...seen].join(); }
function many(turns) { let n = 0; for (let k = 0; k < turns; k++) n += String((k % 701) / 8).length + String(k / 4).length; return n; }
function texts(list) { const out = []; for (const x of list) out.push(String(x), x + "", `${x}`, "" + x); return out.join(" "); }
const mixed = [1.5, 7, "text", null, undefined, true, 10n, [1.5, 2], { toString: () => "o" }, -0, 1.5, 1.25, () => 1, Symbol.iterator, 1.5];
function any(list, turns) { let n = ""; for (let k = 0; k < turns; k++) n = String(list[k % list.length]) + n.length; return n; }
console.log(strings(doubles, 1000), many(5000)); console.log(texts(doubles)); console.log(any(mixed, 100), any(doubles, 100));
const kept = []; for (let round = 0; round < 5; round++) { for (let k = 0; k < 20000; k++) kept[k % 100] = { k, text: String(k / 16) }; console.log(strings(doubles.slice(0, 4), 40), kept[7].text, kept.map(o => o.text).join("").length); }
const frozen = Object.freeze(doubles.slice()); console.log(strings(frozen, 60) === strings(doubles, 60), String(doubles[0]) === String(doubles[0]), new Map(doubles.map(x => [String(x), x])).size);

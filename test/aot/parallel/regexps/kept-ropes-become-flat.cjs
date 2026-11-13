// A joined string that has survived a collection becomes flat when a pattern that is anchored at the start is matched with it.
const { describe } = require("bun:jsc");
const beginnings = ["abc", "de", "", "q", "Ж"];
const ends = ["one", "two", "three"];
const join = (n) => beginnings[n % 5] + ends[n % 3] + n + "." + ends[(n + 1) % 3];
const kept = [];
for (let n = 0; n < 40; n++) kept.push(join(n));
const held = /^(?:x+|[qz])(\d*)/;
const test = (text) => /^[xq]/.test(text);
const index = (text) => text.search(/^(?:y|t)/);
const parts = (text) => { const found = held.exec(text); return found ? found[0] + "/" + found[1] : "none"; };
const isFlat = (text) => !describe(text).includes("rope") && !describe(text).includes("unresolved");
const out = [];
Bun.gc(true);
for (let n = 0; n < 40; n++) out.push(n % 3 === 0 ? test(kept[n]) : n % 3 === 1 ? parts(kept[n]) : index(kept[n]));
for (let n = 0; n < 40; n++) if (n % 3 < 2) out.push(isFlat(kept[n]));
for (let round = 0; round < 3; round++) for (const text of kept) out.push(+test(text) + parts(text) + index(text));
for (let n = 0; n < 40; n++) { const text = join(n); out.push(test(text), parts(text), text.length); }
console.log(out.join(" "));

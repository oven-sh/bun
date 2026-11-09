// What is added is itself a rope of ropes, whose leaves turn wide behind the join.
const count = 30000;
const nameOf = (i, length) => length === 3 ? "m" + (10 + i % 90) : length === 17 ? "quince-tree-" + (10000 + i % 3000) : "the-medlar-in-the-long-orchard-row-" + (10000 + i % 3000);
const lengthAt = (i) => [17, 40, 3][i % 3];
const untouched = (text) => Buffer.from(text, "latin1").toString("latin1");
const wideTwin = (text) => Buffer.from(text, "utf16le").toString("utf16le");
// The 16-bit twin comes first, so its characters are the name of the property: an equal 8-bit text that is used as a key takes them.
const shelf = Object.create(null);
for (let i = 0; i < 3000; i++) for (const length of [3, 17, 40]) shelf[wideTwin(nameOf(i, length))] = 0;
const expected = [];
const report = (what, out) => { const same = expected.join(""); let sum = 0; for (let i = 0; i < out.length; i++) sum = (sum * 31 + out.charCodeAt(i)) | 0; console.log(what, out.length, out.indexOf("\0"), out === same, sum); };
const state = { out: "names:" }; expected.push("names:");
for (let i = 0; i < count; i++) {
  const a = nameOf(i, 17), b = nameOf(i + 1, 40), c = untouched(nameOf(i + 2, 17));
  state.out += (a + "/" + b) + ("|" + c + (b + a));
  shelf[a] += 1; shelf[b] += 1; shelf[c] += 1;
  expected.push(untouched(a), "/", untouched(b), "|", untouched(c), untouched(b), untouched(a));
}
report("ropes", state.out);

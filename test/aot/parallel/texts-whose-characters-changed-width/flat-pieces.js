// The pieces are flat 8-bit strings when they are joined, not ropes: the key swaps the characters of the cell.
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
  const name = untouched(nameOf(i, lengthAt(i)));
  state.out += name;
  shelf[name] += 1;
  expected.push(untouched(name));
}
report("flat", state.out);

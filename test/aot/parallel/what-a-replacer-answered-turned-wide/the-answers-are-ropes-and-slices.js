// The answers are ropes, which the engine makes flat when it gets them, and slices of longer texts.
const wideTwin = (text) => Buffer.from(text, "utf16le").toString("utf16le");
const untouched = (text) => Buffer.from(text, "latin1").toString("latin1");
const nameOf = (i) => "quince-tree-number-" + (1000 + i % 600);
// The 16-bit twin comes first, so its characters are the name of the property: an equal 8-bit text that is used as a key takes them.
const shelf = Object.create(null);
for (let i = 0; i < 600; i++) shelf[wideTwin(nameOf(i))] = 0;
const say = (what, out, expected) => { const right = out === expected; console.log(what, out.length, out.indexOf("\0"), right ? "right" : "wrong"); if (!right) process.exitCode = 1; };
const source = "#,".repeat(3000);
let calls = 0, last = null;
const out = source.replace(/#/g, () => {
  if (last !== null) shelf[last] += 1;
  const i = calls++;
  last = i % 2 ? "quince-tree-" + ("number-" + (1000 + i % 600)) : untouched("<<" + nameOf(i) + ">>").slice(2, -2);
  return last;
});
const expected = []; for (let i = 0; i < 3000; i++) expected.push(untouched(nameOf(i)), ",");
say("ropes and slices", out, expected.join(""));

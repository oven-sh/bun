// Neither the function nor the use as a key is seen by the compiler.
const wideTwin = (text) => Buffer.from(text, "utf16le").toString("utf16le");
const untouched = (text) => Buffer.from(text, "latin1").toString("latin1");
const nameOf = (i) => "quince-tree-number-" + (1000 + i % 600);
// The 16-bit twin comes first, so its characters are the name of the property: an equal 8-bit text that is used as a key takes them.
const shelf = Object.create(null);
for (let i = 0; i < 600; i++) shelf[wideTwin(nameOf(i))] = 0;
const say = (what, out, expected) => { const right = out === expected; console.log(what, out.length, out.indexOf("\0"), right ? "right" : "wrong"); if (!right) process.exitCode = 1; };
const source = "#,".repeat(3000);
const makeReplacer = (0, eval)("(shelf, untouched, nameOf) => { let calls = 0, last = null; return () => { if (last !== null) shelf[last] += 1; last = untouched(nameOf(calls++)); return last; }; }");
const out = source.replace(/#/g, makeReplacer(shelf, untouched, nameOf));
const expected = []; for (let i = 0; i < 3000; i++) expected.push(nameOf(i), ",");
say("unseen", out, expected.join(""));

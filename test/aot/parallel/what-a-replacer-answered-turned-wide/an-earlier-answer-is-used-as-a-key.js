// text.replace(/pattern/g, function) of a long text: the engine asks each answer for its width when it gets it and copies the characters when all calls are done.
// A later call uses an earlier answer as a key, and the name of that property is a 16-bit text.
const wideTwin = (text) => Buffer.from(text, "utf16le").toString("utf16le");
const untouched = (text) => Buffer.from(text, "latin1").toString("latin1");
const nameOf = (i) => "quince-tree-number-" + (1000 + i % 600);
// The 16-bit twin comes first, so its characters are the name of the property: an equal 8-bit text that is used as a key takes them.
const shelf = Object.create(null);
for (let i = 0; i < 600; i++) shelf[wideTwin(nameOf(i))] = 0;
const say = (what, out, expected) => { const right = out === expected; console.log(what, out.length, out.indexOf("\0"), right ? "right" : "wrong"); if (!right) process.exitCode = 1; };
const source = "#,".repeat(3000);
let calls = 0, last = null;
const out = source.replace(/#/g, () => { if (last !== null) shelf[last] += 1; last = untouched(nameOf(calls++)); return last; });
const expected = []; for (let i = 0; i < 3000; i++) expected.push(nameOf(i), ",");
say("flat answers", out, expected.join(""));
console.log(calls);

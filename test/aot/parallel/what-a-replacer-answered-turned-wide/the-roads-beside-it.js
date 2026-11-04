// Right before: a short text, a pattern with a group, a 16-bit text, answers that are wide when they are given, and the text itself used as a key.
const wideTwin = (text) => Buffer.from(text, "utf16le").toString("utf16le");
const untouched = (text) => Buffer.from(text, "latin1").toString("latin1");
const nameOf = (i) => "quince-tree-number-" + (1000 + i % 600);
// The 16-bit twin comes first, so its characters are the name of the property: an equal 8-bit text that is used as a key takes them.
const shelf = Object.create(null);
for (let i = 0; i < 600; i++) shelf[wideTwin(nameOf(i))] = 0;
const say = (what, out, expected) => { const right = out === expected; console.log(what, out.length, out.indexOf("\0"), right ? "right" : "wrong"); if (!right) process.exitCode = 1; };
const replacerOf = () => { let calls = 0, last = null; return () => { if (last !== null) shelf[last] += 1; last = untouched(nameOf(calls++)); return last; }; };
const expectedOf = (count, between) => { const list = []; for (let i = 0; i < count; i++) list.push(nameOf(i), between); return list.join(""); };
say("short", "#,".repeat(300).replace(/#/g, replacerOf()), expectedOf(300, ","));
say("a group", "#,".repeat(3000).replace(/(#)/g, replacerOf()), expectedOf(3000, ","));
say("a wide text", "#✓".repeat(3000).replace(/#/g, replacerOf()), expectedOf(3000, "✓"));
{ let calls = 0; say("wide answers", "#,".repeat(3000).replace(/#/g, () => wideTwin(nameOf(calls++))), expectedOf(3000, ",")); }
{
  const long = untouched("#,".repeat(3000)); const byText = Object.create(null); byText[wideTwin(long)] = 0;
  let calls = 0; say("the text is a key", long.replace(/#/g, (match, offset, whole) => { if (calls === 5) byText[whole] += 1; return untouched(nameOf(calls++)); }), expectedOf(3000, ","));
  console.log(byText[long]);
}

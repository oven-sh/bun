// The last call uses every earlier answer as a key.
const wideTwin = (text) => Buffer.from(text, "utf16le").toString("utf16le");
const untouched = (text) => Buffer.from(text, "latin1").toString("latin1");
const nameOf = (i) => "quince-tree-number-" + (1000 + i % 600);
// The 16-bit twin comes first, so its characters are the name of the property: an equal 8-bit text that is used as a key takes them.
const shelf = Object.create(null);
for (let i = 0; i < 600; i++) shelf[wideTwin(nameOf(i))] = 0;
const say = (what, out, expected) => { const right = out === expected; console.log(what, out.length, out.indexOf("\0"), right ? "right" : "wrong"); if (!right) process.exitCode = 1; };
const source = "#,".repeat(2500);
const answers = [];
const out = source.replace(/#/g, (match, offset) => {
  if (offset === 4998) for (const answer of answers) shelf[answer] += 1;
  const answer = untouched(nameOf(answers.length)); answers.push(answer); return answer;
});
const expected = []; for (let i = 0; i < 2500; i++) expected.push(nameOf(i), ",");
say("in the last call", out, expected.join(""));

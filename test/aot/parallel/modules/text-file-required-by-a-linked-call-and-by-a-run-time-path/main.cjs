// Reference: bun build --compile
// One text file, required where `bun build` links the call and under a path that shows when the program runs.
// The linked call answers the text and the loader answers `{ default }`, whichever comes first.
const show = (name, ...values) => console.log(name, ...values.map(value => JSON.stringify(value)));
const load = name => require(name);
const atRunTime = name => process.argv[9] ?? name;

show("linked first", require("./linked-first.txt"), load(atRunTime("./linked-first.txt")), require("./linked-first.txt"));
show("path first", load(atRunTime("./path-first.txt")), require("./path-first.txt"), load(atRunTime("./path-first.txt")));
show("markdown", require("./page.md"), load(atRunTime("./page.md")), module.require("./page.md"));
show("from another file", require("./from-another-file.txt"), require("./loads.cjs").load(atRunTime("./from-another-file.txt")));

const names = { text: "./name-in-a-table.txt" };
show("name in a table", require("./name-in-a-table.txt"), load(names[atRunTime("text")]));

const made = require("node:module").createRequire(__filename);
show("made", require("./made.txt"), made(atRunTime("./made.txt")));

const answer = load(atRunTime("./linked-first.txt"));
console.log(typeof answer, Object.keys(answer), Object.prototype.toString.call(answer), answer === load(atRunTime("./linked-first.txt")));
console.log(typeof require("./linked-first.txt"), require("./linked-first.txt").length);

// A file of data answers its value to both, a string too.
show("a string in JSON", require("./string.json"), load(atRunTime("./string.json")));
show("an object in JSON", require("./object.json"), load(atRunTime("./object.json")));

require("./module.mjs");

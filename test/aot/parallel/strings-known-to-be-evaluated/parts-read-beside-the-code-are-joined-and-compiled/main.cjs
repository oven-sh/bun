// Files that are read beside the code are joined, with the text of a function behind them, and evaluated as one: what they name is found, and what they keep is kept.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
function between() {
  return "; ";
}
const files = ["measure.js", "stack.js", "report.js"].map(name => path.join(__dirname, "parts", name));
const texts = files.map(file => fs.readFileSync(file, "utf8"));
texts.push(between.toString());
texts.push("out.Stack = Stack; out.report = report; out.measured = function () { return measured; };");
const kit = {};
new Function("out", texts.join("\n;\n"))(kit);
function run(count) {
  const stacks = [new kit.Stack("a"), new kit.Stack("b")];
  for (let at = 0; at < count; at++) {
    stacks[at & 1].put(at + (at % 3 === 0 ? "mm" : at % 3 === 1 ? "cm" : "dm"));
    if (at % 7 === 0) stacks[0].put("nothing" + at);
  }
  return kit.report(stacks);
}
for (let round = 0; round < 20; round++) {
  const line = run(30 + round);
  if (round % 6 === 0) console.log(line, kit.measured());
}
const second = {};
new Function("out", texts.slice(0, 2).join("\n") + "\nout.Stack = Stack; out.kinds = [typeof measure, typeof between, typeof report];")(second);
console.log(second.kinds.join(), second.Stack === kit.Stack, new second.Stack("c").put("4dm").put("x").sum(), kit.measured());
const changed = {};
new Function("out", texts.join("\n").replace("dm: 100", "dm: 1000") + ";out.answer = new Stack('d').put('3dm').sum();")(changed);
console.log(changed.answer, new kit.Stack("e").put("3dm").sum());
try {
  new Function(texts.join("\n") + "\n}")();
} catch (error) {
  console.log(error.constructor.name);
}
try {
  fs.readFileSync(path.join(__dirname, "parts", "absent.js"), "utf8");
} catch (error) {
  console.log(error.code);
}

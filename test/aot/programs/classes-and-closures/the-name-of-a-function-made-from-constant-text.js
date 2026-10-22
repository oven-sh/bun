// `new Function` with constant text is compiled with the program, and its name is "anonymous". Such a function comes first in the program, so its name may be the first string of all.
function nameOf(f) {
  return f.name;
}

function plus(a, b) {
  return a + b;
}

function minus(a, b) {
  return a - b;
}

const show = JSON.stringify;

let lengths = 0;
for (let round = 0; round < 2000; round++) lengths += nameOf(round & 1 ? plus : minus).length + nameOf(function () {}).length + nameOf(() => {}).length;
console.log("lengths", lengths);

const made = new Function("a", "b", "return a");
console.log("made", show(made.name), show(nameOf(made)), show(made.name), show(made.name), show(nameOf(made)));
const called = Function("return 1");
console.log("called", show(called.name), show(nameOf(called)), show(called.name), show(called.name));
const strict = new Function("'use strict'; return this");
for (let round = 0; round < 5; round++) console.log("strict", round, show(strict.name), show(nameOf(strict)));

console.log("without a name", show((function () {}).name), show((() => {}).name), show(nameOf(function () {})), show(nameOf(() => {})), show((class {}).name));
console.log("with a name", show(plus.name), show(nameOf(minus)), show(nameOf(class Named {})), show(nameOf(Math.max)));
console.log("bound", show(made.bind(null).name), show(nameOf(plus.bind(null))), show(nameOf((function () {}).bind(null))));
console.log("descriptor", show(Object.getOwnPropertyDescriptor(made, "name")), show(Object.getOwnPropertyNames(called)));
console.log("behind the descriptor", show(made.name), show(nameOf(made)), show(called.name), show(nameOf(called)));
console.log("text", made.toString().replace(/\s+/g, " "), made(7, 8), called(), typeof strict());

Object.defineProperty(made, "name", { value: "renamed" });
console.log("renamed", show(made.name), show(nameOf(made)), show(nameOf(new Function("a", "b", "return a"))));
console.log("deleted", delete called.name, show(called.name), show(nameOf(called)), "name" in called);
for (const text of ["return 2", "return 3"]) console.log("text of the run time", show(new Function(text).name), show(nameOf(Function(text))));

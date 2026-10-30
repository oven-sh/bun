// A script's const and class.
const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
import vm from "node:vm";
vm.runInThisContext("const limit = 10; const box = { n: 1 }; class Made { static label = 'made by a script'; }");
function readLimit() { return limit; }
function readBox() { return box.n; }
function readClass() { return Made.label; }
function store(value) { limit = value; }
attempt(readLimit);
attempt(readLimit);
attempt(readBox);
attempt(readClass);
attempt(() => store(11));
attempt(readLimit);
box.n = 2;
attempt(readBox);
attempt(() => "limit" in globalThis);
attempt(() => vm.runInThisContext("limit + box.n"));
console.log(told.join("\n"));

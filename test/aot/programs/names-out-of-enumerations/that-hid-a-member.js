// The object has an enumerable property under the name of a member of the engine, by every way a program can put one there. The loop takes it away and reads again: the member comes out.
const kinds = v => (v === Object ? "Object" : v === Object.prototype.toString ? "toString" : v === Object.prototype.valueOf ? "valueOf" : v === Object.prototype.hasOwnProperty ? "hasOwnProperty" : typeof v);
function drain(o) {
  const found = [];
  for (const name in o) {
    if (name === "skip") continue;
    if (typeof name !== "string") continue;
    delete o[name];
    found.push(name + "=" + kinds(o[name]));
  }
  return found.join();
}
const dynamic = {}; for (const k of ["constructor", "plain"]) dynamic[k + ""] = 1;
class WithField { toString = 1; other = 2; }
function Legacy() { this.valueOf = 1; }
const defined = Object.defineProperty({}, "hasOwnProperty", { value: 1, enumerable: true, configurable: true });
const accessor = { get constructor() { return 5; }, skip: 1 };
console.log(drain({ constructor: 1, a: 2 }));
console.log(drain(dynamic));
console.log(drain({ ...JSON.parse('{"constructor":1,"valueOf":2}') }));
console.log(drain(Object.assign({}, { toString: 1 })));
console.log(drain(Object.fromEntries([["hasOwnProperty", 1]])));
console.log(drain(JSON.parse('{"toString":1,"x":2}')));
console.log(drain(new WithField()), drain(new Legacy()), drain(defined), drain(accessor));
// The name is inherited from an object of the program, and that object loses it.
const above = { constructor: 1, toString: 2 }, below = Object.create(above);
function drainAbove(o, holder) { const found = []; for (const name in o) { delete holder[name]; found.push(name + "=" + kinds(o[name])); } return found.join(); }
console.log(drainAbove(below, above));
// An array and a function.
const list = [1]; list.concat = 2; list.at = 3;
function drainList(o) { const found = []; for (const name in o) { delete o[name]; found.push(name + "=" + (o[name] === Array.prototype.concat ? "concat" : o[name] === Array.prototype.at ? "at" : typeof o[name])); } return found.join(); }
console.log(drainList(list));
function f() {} f.call = 1; f.prototype2 = 2;
function drainFunction(o) { const found = []; for (const name in o) { delete o[name]; found.push(name + "=" + (o[name] === Function.prototype.call ? "call" : typeof o[name])); } return found.join(); }
console.log(drainFunction(f));
// The variable is given another object, or the name another text, between the step and the read.
function other(o, p) { const found = []; for (let name in o) { const was = o; o = p; found.push(kinds(o[name])); o = was; name = "constructor"; found.push(kinds(o[name])); } return found.join(); }
console.log(other({ toString: 1 }, {}));

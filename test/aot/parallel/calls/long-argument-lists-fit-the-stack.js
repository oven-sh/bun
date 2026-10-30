function count(...all) {
  return all.length;
}
function counted(a, b) {
  return arguments.length;
}
function sum(a, b) {
  return a + b;
}
function forwardRest(...all) {
  return 1 + count(...all);
}
function forwardArguments() {
  return 1 + count.apply(null, arguments);
}
function forwardRestToNative(...all) {
  return 1 + Math.max(...all);
}
function forwardArgumentsToNative() {
  return 1 + Math.max.apply(null, arguments);
}
function tail(list) {
  "use strict";
  return count(...list);
}
function tailForward() {
  "use strict";
  return count.apply(null, arguments);
}
async function later(...all) {
  return all.length;
}
function* steps(...all) {
  yield all.length;
}
class Base {
  constructor(...all) {
    this.n = all.length;
  }
}
class Derived extends Base {
  constructor(...all) {
    super(...all);
  }
}
class Implicit extends Base {}
function Old() {
  this.n = arguments.length;
}
const bound = count.bind(null, 1);
const made = new Function("...all", "return all.length");
const end = process.argv.length > 99 ? "x" : ";";
const spreads = new Function("f", "list", "return 1 + f(...list)" + end);
const spreadsBehindAnArgument = new Function("f", "list", "return 1 + f(0, ...list)" + end);
const applies = new Function("f", "list", "return 1 + f.apply(null, list)" + end);
const tailCalls = new Function("f", "list", "'use strict'; return f(...list)" + end);
const constructs = new Function("f", "list", "return new f(...list).n" + end);
const MadeHeir = new Function("Base", "return class extends Base { constructor(...all) { super(...all); } }" + end)(
  Base,
);
const MadeImplicit = new Function("Base", "return class extends Base { }" + end)(Base);
const apply = [Function.prototype.apply][0];
const reflectApply = [Reflect.apply][0];
const reflectConstruct = [Reflect.construct][0];

const once = {
  "a spread": list => count(...list),
  "a spread, arguments": list => counted(...list),
  "a spread, parameters": list => sum(...list),
  "a spread behind an argument": list => count(0, ...list),
  "a method": list => ({ count }).count(...list),
  "apply": list => count.apply(null, list),
  "apply as a value": list => apply.call(count, null, list),
  "call": list => count.call(null, ...list),
  "Reflect.apply": list => Reflect.apply(count, null, list),
  "Reflect.apply as a value": list => reflectApply(count, null, list),
  "new": list => new Base(...list).n,
  "new of a function": list => new Old(...list).n,
  "Reflect.construct": list => Reflect.construct(Base, list).n,
  "Reflect.construct as a value": list => reflectConstruct(Base, list).n,
  "a tail call": list => tail(list),
  "an async function": list => typeof later(...list),
  "a generator": list => steps(...list).next().value,
  "holes": list => count(...new Array(list.length)),
  "an array-like": list => count.apply(null, { length: list.length }),
  "a typed array": list => count(...new Uint8Array(list.length)),
  "doubles": list => count(...list.map(x => x + 0.5)),
  "strings": list => count(...list.map(String)),
  "text made at run time": list => made(...list),
  "a spread in text made at run time": list => spreads(count, list),
  "a spread in text, arguments": list => spreads(counted, list),
  "a spread in text, parameters": list => spreads(sum, list),
  "a spread in text behind an argument": list => spreadsBehindAnArgument(count, list),
  "apply in text": list => applies(count, list),
  "a tail call in text": list => tailCalls(count, list),
  "new in text": list => constructs(Base, list),
  "new of a function in text": list => constructs(Old, list),
  "a generator called by text": list => tailCalls(steps, list).next().value,
  "a native function": list => Math.max(...list),
  "push": list => [].push(...list),
};
const twice = {
  "super": list => new Derived(...list).n,
  "a class without a constructor": list => new Implicit(...list).n,
  "a rest parameter handed on": list => forwardRest(...list),
  "arguments handed on": list => forwardArguments(...list),
  "a rest parameter handed to a native function": list => forwardRestToNative(...list),
  "arguments handed to a native function": list => forwardArgumentsToNative(...list),
  "arguments handed on in a tail call": list => tailForward(...list),
  "a bound function": list => bound(...list),
  "a bound function called by text": list => spreads(bound, list),
  "super below new in text": list => constructs(Derived, list),
  "a class without a constructor below new in text": list => constructs(Implicit, list),
  "super in text": list => new MadeHeir(...list).n,
  "a class without a constructor in text": list => new MadeImplicit(...list).n,
};

const kept = [];
function answers(run, n) {
  try {
    kept.push(run(new Array(n).fill(1)));
    return true;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return false;
  }
}
let most = 1000,
  tooMany = 4000000;
while (tooMany - most > 1000) {
  const middle = (most + tooMany) >> 1;
  if (answers(once["a spread"], middle)) most = middle;
  else tooMany = middle;
}
for (const name in once) console.log(name, answers(once[name], Math.floor(most * 0.9)));
for (const name in twice) console.log(name, answers(twice[name], Math.floor(most * 0.45)));
console.log(kept.every(value => value === "object" || value > 0));

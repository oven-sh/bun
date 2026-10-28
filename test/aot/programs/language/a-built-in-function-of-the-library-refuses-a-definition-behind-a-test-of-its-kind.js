// A built-in function that the library writes in JavaScript never gets a call, apply, bind or Symbol.hasInstance of its own in a compiled program. Here the program has tested that what it found is a function
// or an object, so the build knows that much of it and no more, and the descriptor is written out.
const hidden = (holder, key) => globalThis[[holder, ""].join("")].prototype[key];
function planted() { return "planted ran"; }
const attempt = run => { try { return String(run()); } catch (error) { return error.name + ": " + error.message.split(" (")[0]; } };

const found = {
  "Array.prototype.map": () => hidden("Array", "map"),
  "Array.prototype.forEach": () => hidden("Array", "forEach"),
  "Function.prototype.call": () => hidden("Function", "call"),
  "Reflect.get": () => globalThis[["Ref", "lect"].join("")].get,
};
const told = error => error.name + ": " + error.message.split(" (")[0];
for (const name in found) {
  const builtin = found[name]();
  if (typeof builtin === "function") {
    try { Object.defineProperty(builtin, "call", { value: planted }); console.log(name, "call: defined"); } catch (error) { console.log(name, "call:", told(error)); }
    try { Object.defineProperty(builtin, "apply", { value: planted, writable: true, enumerable: true, configurable: true }); console.log(name, "apply: defined"); } catch (error) { console.log(name, "apply:", told(error)); }
    try { Object.defineProperty(builtin, "bind", { get: planted, configurable: true }); console.log(name, "bind: defined"); } catch (error) { console.log(name, "bind:", told(error)); }
    try { Object.defineProperty(builtin, Symbol.hasInstance, { value: planted }); console.log(name, "Symbol.hasInstance: defined"); } catch (error) { console.log(name, "Symbol.hasInstance:", told(error)); }
    try { Object.defineProperty(builtin, "mine", { value: planted, configurable: true }); console.log(name, "another name:", builtin.mine()); } catch (error) { console.log(name, "another name:", told(error)); }
  }
  if (builtin instanceof Object) {
    try { Object.defineProperty(builtin, "call", { value: planted }); console.log(name, "as an object: defined"); } catch (error) { console.log(name, "as an object:", told(error)); }
  }
  console.log(name, "own names:", Object.getOwnPropertyNames(builtin).filter(own => own !== "length" && own !== "name" && own !== "prototype").join());
}
console.log(String(Array.prototype.map.call([1, 2], x => x * 2)), Reflect.get.call(null, { a: 7 }, "a"));

// A function of the program takes all of them.
function own() { return "own ran"; }
const anyFunction = [own][[0].length - 1];
if (typeof anyFunction === "function") {
  console.log(attempt(() => { Object.defineProperty(anyFunction, "call", { value: planted }); return anyFunction.call(); }));
  console.log(attempt(() => { Object.defineProperty(anyFunction, Symbol.hasInstance, { value: () => true }); return 1 instanceof anyFunction; }));
}

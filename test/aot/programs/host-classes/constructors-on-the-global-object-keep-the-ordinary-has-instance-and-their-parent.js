// CALLS- isBlob InstanceOf\.Constructor
// CALLS+ isForm InstanceOf\.Prototype
// Every constructor on the global object, the host's among them, keeps the ordinary Symbol.hasInstance and its parent: `x instanceof Blob` is a walk up the chain of x.
const names = Object.getOwnPropertyNames(globalThis).filter(name => typeof globalThis[name] === "function" && /^[A-Z]/.test(name)).sort();
const taken = [];
for (const name of names) {
  const constructor = globalThis[name], parent = Object.getPrototypeOf(constructor);
  for (const key of [Symbol.hasInstance, "call", "apply", "bind"]) {
    if (Object.hasOwn(constructor, key)) continue;
    try { Object.defineProperty(constructor, key, { value: () => true, configurable: true }); taken.push(name + " takes " + String(key)); delete constructor[key]; } catch (error) { if (error.name !== "TypeError") taken.push(name + " throws " + error.name); }
    try { "use strict"; constructor[key] = () => true; if (Object.hasOwn(constructor, key)) { taken.push(name + " stores " + String(key)); delete constructor[key]; } } catch (error) {}
    if (Reflect.set(constructor, key, () => true) && Object.hasOwn(constructor, key)) taken.push(name + " is set " + String(key));
  }
  try { Object.setPrototypeOf(constructor, function () {}); taken.push(name + " takes a parent"); Object.setPrototypeOf(constructor, parent); } catch (error) {}
  if (Reflect.setPrototypeOf(constructor, null)) taken.push(name + " loses its parent");
}
console.log(names.length > 90, taken.join("; ") || "nothing is taken");
function isBlob(x) { return x instanceof Blob; }
function isForm(x) { return "function" == typeof FormData && x instanceof FormData; }
function isFile(x) { return x instanceof File; }
class Below extends Blob {}
class Form extends FormData {}
const values = [new Blob([]), new File([], "f"), new Below([]), new FormData(), new Form(), Object.create(Blob.prototype), Object.create(FormData.prototype), Object.setPrototypeOf(new Blob([]), null), Object.setPrototypeOf({}, new FormData()), new Proxy(new Blob([]), {}), new Proxy({}, { getPrototypeOf() { return FormData.prototype; } }), {}, [], () => 1, "t", 5, null, undefined, Symbol.iterator, 1n, Blob, FormData, Blob.prototype, FormData.prototype];
let lines = [];
for (let round = 0; round < 50; round++) lines = [isBlob, isForm, isFile].map(test => test.name + " " + values.map(value => +test(value)).join(""));
console.log(lines.join("\n"));
const revoked = Proxy.revocable({}, {}); revoked.revoke();
for (const test of [isBlob, isForm]) { try { console.log(test(revoked.proxy)); } catch (error) { console.log(error.name); } }

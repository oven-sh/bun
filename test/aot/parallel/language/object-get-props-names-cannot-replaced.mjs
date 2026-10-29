// Object.getOwnPropertyNames is locked in a compiled executable. Every way of replacing it is refused, and the function goes on answering.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const original = Object.getOwnPropertyNames;
const name = ["get", "Own", "Property", "Names"].join("");
function planted() {
  return ["planted"];
}
const doors = {
  "an assignment": () => { Object.getOwnPropertyNames = planted; },
  "an assignment through a variable": () => { const holder = Object; holder.getOwnPropertyNames = planted; },
  "a computed key": () => { Object[name] = planted; },
  "a value nobody can follow": () => { unknown(Object).getOwnPropertyNames = planted; },
  "a value nobody can follow and a computed key": () => { unknown(Object)[name] = planted; },
  "Object.defineProperty": () => { Object.defineProperty(Object, "getOwnPropertyNames", { value: planted }); },
  "Object.defineProperty with a getter": () => { Object.defineProperty(Object, name, { get: () => planted }); },
  "Object.defineProperties": () => { Object.defineProperties(Object, { getOwnPropertyNames: { value: planted } }); },
  "Reflect.defineProperty": () => { if (!Reflect.defineProperty(Object, "getOwnPropertyNames", { value: planted })) throw new TypeError("false"); },
  "Reflect.set": () => { if (!Reflect.set(Object, "getOwnPropertyNames", planted)) throw new TypeError("false"); },
  "Reflect.set under a computed key": () => { if (!Reflect.set(unknown(Object), name, planted)) throw new TypeError("false"); },
  "Object.assign": () => { Object.assign(Object, { getOwnPropertyNames: planted }); },
  "Object.assign with a computed key": () => { Object.assign(unknown(Object), { [name]: planted }); },
  "delete": () => { delete Object.getOwnPropertyNames; },
  "Reflect.deleteProperty": () => { if (!Reflect.deleteProperty(Object, name)) throw new TypeError("false"); },
  "__defineGetter__": () => { Object.__defineGetter__("getOwnPropertyNames", () => planted); },
  "a helper that takes object, key and value": () => { ((object, key, value) => { object[key] = value; })(Object, name, planted); },
  "text evaluated at run time": () => { new Function("planted", "'use strict'; Object." + name + " = planted;")(planted); },
  "an indirect eval": () => { globalThis.plantedForEval = planted; (0, eval)("'use strict'; Object." + name + " = plantedForEval;"); },
};
for (const [door, open] of Object.entries(doors)) {
  let verdict = "stored";
  try {
    open();
  } catch (error) {
    verdict = error.constructor.name;
  }
  const names = Object.getOwnPropertyNames({ a: 1, b: 2 });
  console.log(door + ":", verdict, names.join(), Object.getOwnPropertyNames === original, Object[name] === original);
}
const getOwnPropNames = Object.getOwnPropertyNames;
console.log(getOwnPropNames({ first() {}, second: 2 })[0], Object.getOwnPropertyDescriptor(Object, name).writable);
Object.somethingNew = 1;
console.log(Object.somethingNew);
/* Output:
an assignment: TypeError a,b true true
an assignment through a variable: TypeError a,b true true
a computed key: TypeError a,b true true
a value nobody can follow: TypeError a,b true true
a value nobody can follow and a computed key: TypeError a,b true true
Object.defineProperty: TypeError a,b true true
Object.defineProperty with a getter: TypeError a,b true true
Object.defineProperties: TypeError a,b true true
Reflect.defineProperty: TypeError a,b true true
Reflect.set: TypeError a,b true true
Reflect.set under a computed key: TypeError a,b true true
Object.assign: TypeError a,b true true
Object.assign with a computed key: TypeError a,b true true
delete: TypeError a,b true true
Reflect.deleteProperty: TypeError a,b true true
__defineGetter__: TypeError a,b true true
a helper that takes object, key and value: TypeError a,b true true
text evaluated at run time: TypeError a,b true true
an indirect eval: TypeError a,b true true
first true
1
*/

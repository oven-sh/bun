// A built-in object stands behind a proxy, and the program puts new names on it through the proxy. Compiled code that reads the names off the built-in finds what was put there.
function twice(read) {
  let sum = 0;
  for (let round = 0; round < 2; round++) sum += read();
  return sum;
}
const json = new Proxy(JSON, {});
json.stored = 7;
console.log("a store:", JSON.stored, twice(() => JSON.stored));
Reflect.set(json, "set", 8);
console.log("Reflect.set:", JSON.set, twice(() => JSON.set));
Object.defineProperty(json, "defined", { value: 9, configurable: true });
console.log("Object.defineProperty:", JSON.defined, twice(() => JSON.defined));
Object.assign(json, { assigned: 10 });
console.log("Object.assign:", JSON.assigned, twice(() => JSON.assigned));
const math = new Proxy(Math, {});
for (const name of ["first", "second"]) math[name] = name.length;
console.log("in a loop:", Math.first, Math.second, twice(() => Math.first + Math.second));
math.helper = function helper() { return "called"; };
console.log("a function:", Math.helper());
delete json.stored;
console.log("deleted:", JSON.stored, "stored" in JSON);

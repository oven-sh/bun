// An import that never runs names `node:repl`, which evaluates text while it loads, so the names `Promise` and `Date` could hold anything. Reads one member of each of six built-in objects where
// nothing takes the value, then walks a list of the six, copies each and prints its own keys.
if (Date.now() < 0) await import("node:repl");
let count = 0;
void Promise.race;
Date.UTC;
count += (String.raw, 1);
if (Symbol.keyFor) count++;
if (!Reflect.set) count--;
Object.freeze && count++;
for (const object of [Promise, Date, String, Symbol, Reflect, Object]) {
  const entries = Object.entries(object);
  console.log(entries.length, Reflect.ownKeys(object).map(String).join());
}
console.log(count);

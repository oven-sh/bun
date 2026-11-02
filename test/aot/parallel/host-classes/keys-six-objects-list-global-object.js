// The global object takes members out of parsed text, so the names `Promise` and `Date` could hold anything. Reads one member of each of six built-in objects where nothing takes the value,
// then walks a list of the six, copies each and prints its own keys.
Object.assign(globalThis, JSON.parse(Date.now() > 0 ? '{"made":1}' : "{}"));
let count = made;
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

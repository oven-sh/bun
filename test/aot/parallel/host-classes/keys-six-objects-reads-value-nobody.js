// Reads one member of each of six built-in objects where nothing takes the value: under void, as a statement, to the left of a comma,
// as a test, under `!` and beside `&&`. Then it copies each object and prints its own keys.
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

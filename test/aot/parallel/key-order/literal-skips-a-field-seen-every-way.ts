// A literal lists a and c of { a, b?, c? }, and a store creates b behind it. Every way to list the keys of the object says a, c, b: where it was made, and in a function that is handed it.
type Row = { a: number; b?: number; c?: number };
function seen(row: Row) {
  const names: string[] = [];
  for (const name in row) names.push(name);
  return [
    names.join(),
    Object.keys(row).join(),
    Object.values(row).join(),
    JSON.stringify(Object.entries(row)),
    JSON.stringify(row),
    JSON.stringify(structuredClone(row)),
    JSON.stringify(Object.assign({}, row)),
    Object.getOwnPropertyNames(row).join(),
    Reflect.ownKeys(row).join(),
    JSON.stringify(Object.getOwnPropertyDescriptors(row)),
    JSON.stringify(Object.fromEntries(Object.entries(row))),
    Bun.inspect(row),
  ].join(" | ");
}
const x = Math.floor(Math.random()) + 1;
const row: Row = { a: x, c: x };
row.b = x + 1;
const names: string[] = [];
for (const name in row) names.push(name);
console.log(names.join());
console.log(Object.keys(row).join());
console.log(Object.values(row).join());
console.log(JSON.stringify(Object.entries(row)));
console.log(JSON.stringify(row));
console.log(JSON.stringify(structuredClone(row)));
console.log(JSON.stringify(Object.assign({}, row)));
console.log(Object.getOwnPropertyNames(row).join());
console.log(Reflect.ownKeys(row).join());
console.log("c" in row, Object.hasOwn(row, "c"), row.hasOwnProperty("c"), row.propertyIsEnumerable("c"), row.c);
console.log(row);
console.log(seen(row));

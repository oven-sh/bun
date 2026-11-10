// STATISTIC: RestsOfPatternsThatAreDefinitionsOneByOne >= 1
// The row is born with the layout that the pattern's loop expects and changed behind its birth through a key that nobody knows: the layout alone says nothing of that: the copy asks the row for its own keys.
const log = [];
function show(o) { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(Object.getOwnPropertyDescriptor(o, k).get ? "getter" : o[k])).join(","); }
const sym = Symbol("s");
function born(id, name, age) { return { id, name, age }; }
const key = text => JSON.parse(JSON.stringify(text));
function put(o, k, v) { o[k] = v; }
function drop(o, k) { delete o[k]; }
function define(o, k, d) { Object.defineProperty(o, k, d); }
const odd = born(9, "n", 8);
const rows = [born(1, "a", 5), born(2, "b", 6), odd, born(3, "c", 7)];
const lines = [];
function omit(row) { const { id, ...rest } = row; return rest; }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < rows.length; i++) lines.push(i + " " + show(omit(rows[i])));
}
console.log(lines.join("|"));
console.log(log.length);

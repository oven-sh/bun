class Row { #secret = 7; #hidden() { return 1; } id; name; age = 5; constructor(i) { this.id = i; this.name = "n" + i; } get shown() { return this.#secret; } }
function show(o) { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + "=" + String(d.value) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join() + (Object.getPrototypeOf(o) === Object.prototype ? "#plain" : "#other"); }
function omit(row) { const { id, ...rest } = row; return rest; }
const n = JSON.parse("3"), rows = [], lines = []; for (let i = 0; i < n; i++) rows.push(new Row(i));
for (let i = 0; i < rows.length; i++) lines.push(show(omit(rows[i])));
console.log("SAID " + lines.join(" "));

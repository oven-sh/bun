// A setter that a descriptor lays on an instance, or on what Object.fromEntries() gives, is found by stores under joined names, and what it does with the value is seen.
class Row { constructor(n) { this.n = n; } }
class Table {}
const keys = JSON.parse('["x","y","z"]'), isText = v => typeof v === "string";
function tell(rows) { let s = ""; for (const r of rows) s += isText(r.n) ? "t" : "n"; console.log(s); }
{ const rows = [new Row(1), new Row(2), new Row(3)], table = new Table(); Object.defineProperty(table, "kx", { set(v) { v.n = "late"; }, configurable: true }); for (let i = 0; i < 3; i++) table["k" + keys[i]] = rows[i]; tell(rows); }
{ const rows = [new Row(1), new Row(2), new Row(3)], table = Object.fromEntries([["a", 1]]); Object.defineProperties(table, { ky: { set(v) { v.n = "late"; }, configurable: true } }); for (let i = 0; i < 3; i++) table["k" + keys[i]] = rows[i]; tell(rows); }
{ const rows = [new Row(1), new Row(2), new Row(3)], kept = [], table = new Table(); for (let i = 0; i < 3; i++) table["k" + keys[i]] = rows[i]; delete table.kz; Reflect.defineProperty(table, "kz", { set(v) { kept.push(v); } }); table["k" + keys[2]] = rows[2]; for (const r of kept) r.n = "late"; tell(rows); }

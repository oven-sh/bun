// `order[t]` gives an integer or nothing, and a view out of a field that may hold null is read under it: the integer reads the element in line; what is no integer (undefined, a text, a boolean, null) is looked for by the key as it is: "1" is an element, "x" and undefined are names. Where the field holds null the read throws before the key is looked at.
function Bank(size) {
  this.data = null;
  this.order = new Array(size >> 1);
  for (let j = 0; j < this.order.length; j++) { this.order[j] = 0; this.order[j] |= ((j * 3) & 31) - 1; }
  this.mixed = [1, "1", "x", 2, true, null, "-0", "1.5", 3, undefined, "2", "1e1", "10"];
}
Bank.prototype.one = function (off) { const data = this.data; return data[off] + data[off + 1]; };
Bank.prototype.kind = function (key) { const data = this.data; const x = data[key]; return x === undefined ? "u" : String(x); };
Bank.prototype.all = function (view, n) { this.data = view; const order = this.order; let s = 0, missing = 0; for (let t = 0; t < n; t++) { const y = this.one(order[t]); if (y === y) s += y; else missing++; } this.data = null; return missing + " " + s; };
Bank.prototype.kinds = function (view, n) { this.data = view; const mixed = this.mixed; let out = ""; for (let t = 0; t < n; t++) out += this.kind(mixed[t]) + ","; this.data = null; return out; };
function filled(size, named) { const view = new Float64Array(size); for (let i = 0; i < size; i++) view[i] = i / 4 + 0.125; if (named) { view.undefined = 100.5; view.x = 200.5; view.true = 300.5; view.null = 400.5; } return view; }
const B = new Bank(16), plain = filled(16, 0), named = filled(16, 1), none = filled(0, 1);
for (let turn = 0; turn < 3; turn++) for (const n of [4, 8, 11, 15]) console.log(n, B.all(plain, n), "|", B.all(named, n), "|", B.all(none, n), "|", B.kinds(plain, n), "|", B.kinds(named, n), "|", B.kinds(none, n));
const key = { toString() { console.log("the key is asked"); return "0"; } };
try { B.one(3); } catch (error) { console.log(error instanceof TypeError); }
try { B.kind(key); } catch (error) { console.log(error instanceof TypeError); }
B.data = plain; console.log(B.kind(key), B.one(undefined), B.one(2));

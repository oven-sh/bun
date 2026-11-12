// Fields hold arrays that a helper fills with typed arrays; loops read their elements, which are replaced, removed, detached or of other classes.
function make(length, value, kind) {
  switch (kind) { case "uint8": var made = new Uint8Array(length); break; case "int16": var made = new Int16Array(length); break; case "float32": var made = new Float32Array(length); }
  for (var i = 0; i < length; i++) made[i] = value + i;
  return made;
}
function makeCache(tiles, length) { var cache = []; var tile = 0; while (tile < tiles) { cache[tile] = make(length, tile * 60, "uint8"); tile++; } return cache; }
function makeMixed(tiles) { var rows = []; for (var t = 0; t < tiles; t++) rows[t] = t & 1 ? make(4, t, "int16") : make(4, t, "float32"); return rows; }
function makeLists(tiles) { var rows = []; for (var t = 0; t < tiles; t++) rows[t] = [t, t + 0.5, "x"]; return rows; }
function Screen() { this.cache = null; this.mixed = []; this.lists = null; this.bank = null; this.pixels = []; this.start(); }
Screen.prototype.start = function () { this.cache = makeCache(6, 9); this.mixed = makeMixed(6); this.lists = makeLists(6); this.bank = this.cache; this.pixels = make(64, 0, "uint8"); };
Screen.prototype.paint = function (event, at) { var p = 0; for (var t = 0; t < 6; t++) { if (t === at) event(this); var tile = this.cache[t]; for (var i = 0; i < 8; i++) this.pixels[p++] = tile[i] | (t << 1); } return Array.prototype.join.call(this.pixels); };
Screen.prototype.sum = function (event, at) { var all = 0; for (var t = 0; t < 6; t++) { if (t === at) event(this); all += this.bank[t][t] + this.mixed[t][1] + this.lists[t][1]; } return all; };
Screen.prototype.change = function (event, at) { for (var t = 0; t < 6; t++) { if (t === at) event(this); this.cache[t][2] ^= 255; this.cache[t][3] += 200; ++this.mixed[t][0]; } return this.cache.map(tile => Array.prototype.join.call(tile)).join("/") + " " + this.mixed.map(tile => Array.prototype.join.call(tile)).join("/"); };
const events = {
  none: () => {}, array: s => { s.cache[4] = [1.5, , "3", 4]; s.mixed[4] = [0, 9]; }, float: s => { s.cache[4] = new Float64Array([0.5, 1.5, 2.5, 3.5]); }, text: s => { s.cache[4] = "01234567"; }, hole: s => { delete s.cache[4]; }, nothing: s => { s.cache[5] = null; },
  detach: s => { s.cache[4].buffer.transfer(); }, shorter: s => { s.cache.length = 5; }, other: s => { s.cache = makeMixed(6); }, sparse: s => { s.cache[100000] = 1; }, frozen: s => { Object.freeze(s.cache); }, getter: s => { Object.defineProperty(s.cache, 4, { get() { return [7, 8, 9, 10, 11, 12, 13, 14]; } }); },
  clamped: s => { s.cache[3] = new Uint8ClampedArray([300, 1, 2, 3, 4]); }, big: s => { s.cache[3] = new BigUint64Array(4); }, list: s => { s.lists[3] = make(3, 1, "uint8"); }, object: s => { s.cache[3] = { 0: 1, 2: "5", length: 3 }; },
};
for (const [name, event] of Object.entries(events)) {
  for (const at of [0, 3]) {
    const line = [];
    for (const use of ["paint", "sum", "change"]) { try { line.push(new Screen()[use](event, at)); } catch (error) { line.push(error.constructor.name); } }
    console.log(name, at, line.join(" | "));
  }
}

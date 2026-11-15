// Objects that get their fields by every door, made by a generator: their keys come in the order of creation, however they are asked for.
let seen = "";
const mark = Symbol("mark"), keyNames = ['valueOf', 'toString', '0', 'length', '1', 'x', 'hasOwnProperty', 'y'];
function pick(at, n) { return keyNames[(at + n) % keyNames.length]; }
function helper0(o, n) { o.host = 1;
  helper0(o, n); }
function helper1(o, n) { const given = { mode: n, 1: "e" }; Object.assign(o, given);
  Object.defineProperty(o, "x", { value: 2.5, writable: true, enumerable: true, configurable: true }); }
function Client(given, n) { for (let j = 0; j < (n & 1) + 1; j++) { this.toString = [n]; }
  this.y = 2147483648;
  Object.defineProperties(this, Object.getOwnPropertyDescriptors(given));
   }
class Row {  constructor(given, n) { this.hasOwnProperty = 1;
  delete this.size; } late(given, n) { this.hasOwnProperty = "t";
  this.x = true;
  delete this[7]; return this; } }
class Below extends Row { constructor(given, n) { super(given, n); for (let j = 0; j < (n & 1) + 1; j++) { Object.defineProperty(this, "valueOf", { value: null, writable: true, enumerable: true, configurable: true }); }
  Object.defineProperties(this, Object.getOwnPropertyDescriptors(given)); } }
function made(given, n) { const o = { size: "l", x: 1, y: "l" }; if (n & 1) { for (let j = 0; j < (n & 1) + 1; j++) { o.mode = "k" + n; } o.kind = 2147483648; }
  o.hasOwnProperty = undefined; return o; }
function bare(given, n) { const o = {}; o.constructor = 2147483648;
  o[1] = [n];
  o[pick(7, n)] = "k" + n;
  o.kind = 2147483648; return o; }
function loose(given, n) { const o = Object.create(null); Reflect.set(o, "y", true);
  Object.defineProperty(o, "length", { value: [n], writable: true, enumerable: true, configurable: true });
  if (n & 1) { o.constructor = true; }
  o.hasOwnProperty = "k" + n; return o; }
const attempt = make => { try { return make(); } catch (error) { return { error: error.constructor.name }; } };
const ask = o => { let inward = ""; for (const key in o) inward += key + ";"; let text; try { text = JSON.stringify(o); } catch { text = "!"; } return [Object.keys(o).join(), inward, text, Object.keys({ ...o }).join(), Object.entries(o).map(([k, v]) => k + typeof v).join(), Reflect.ownKeys(o).map(String).join(), Object.keys(Object.assign({}, o)).join(), Object.values(o).length].join("|"); };
const all = [{ hasOwnProperty: 2147483648, 1: 3 + 0.5, host: "k" + 3, valueOf: 1 }, { 0: 3 + 0.5, y: undefined }, {  }, { 7: -0, 0: 3 + 0.5 }, { size: 2.5, port: 3 + 0.5 }];
let digest = 0, cases = 0;
for (let turn = 0; turn < 6; turn++) {
  for (let g = 0; g < all.length; g++) {
    const n = turn * 7 + g, given = all[g];
    const objects = [attempt(() => new Client(given, n)), attempt(() => new Row(given, n)), attempt(() => new Row(given, n).late(given, n)), attempt(() => new Below(given, n)), attempt(() => made(given, n)), attempt(() => bare(given, n)), attempt(() => loose(given, n))];
    for (let k = 0; k < objects.length; k++) { const line = ask(objects[k]); cases++; for (let i = 0; i < line.length; i++) digest = (Math.imul(digest, 31) + line.charCodeAt(i)) | 0; if (turn === 0 || turn === 5) console.log(turn, g, k, line); }
  }
}
console.log(cases, digest, seen.length);

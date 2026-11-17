// After a caught throw a loop runs its hoisted guards again. Here the handlers change what those guards tested.
class Cell { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } }
const sum = Cell.prototype.sum;
let list, other, cells, view, rows, grown, total, bound, changes, deeds = 0;
const box = { n: 1 };
function fill() {
  list = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k % 6 === 2 ? -1 - k : k)).join() + "]");
  other = list.map(v => v & 15);
  cells = other.map((v, k) => new Cell(v, k));
  view = new Uint8Array(other);
  rows = [other, list.map(v => v & 3)];
  grown = []; total = 1; bound = 24; box.n = 1; Cell.prototype.sum = sum;
}
function deed() { changes[deeds++ % changes.length](); }
class Hook extends Error {
  toString() { deed(); return "hook"; }
  valueOf() { deed(); return 2; }
  get size() { deed(); return 3; }
}
const trapped = () => new Proxy(new Error("trapped"), { getPrototypeOf(target) { deed(); return Object.getPrototypeOf(target); } });
function plus(v) { if (v < 0) throw new Hook("negative"); return v + 1; }
function checked(v) { if (v < 0) throw trapped(); return v; }
function whole(v) { let s = 0; try { s = checked(v) & 255; } catch (error) { if (error instanceof RangeError) s--; else s -= 2; } return s; }
function ignored(v) { try { return plus(v); } catch (error) { grown.push(String(error)); return -1; } }
const loops = [
  function elements() { let s = 0; for (let i = 0; i < 24; i++) { const v = list[i]; try { s = (s + plus(v)) | 0; } catch (error) { s = (s + String(error).length) | 0; } s = (s + other[i]) | 0; } return s; },
  function doubles() { let s = 0; for (let i = 0; i < other.length; i++) { try { s = s + plus(list[i]); } catch (error) { s = s + +error; } s = s + other[i]; } return s; },
  function fields() { let s = 0; for (let i = 0; i < 24; i++) { const c = cells[i]; try { s = (s + plus(list[i])) | 0; } catch (error) { if (error < 4) s--; } s = (s + c.a + c.b) | 0; } return s; },
  function methods() { let s = 0; for (let i = 0; i < 24; i++) { s = (s + whole(list[i]) + cells[i].sum()) | 0; } return s; },
  function views() { let s = 0; for (let i = 0; i < 24; i++) { s = (s + ignored(list[i])) | 0; s = (s + view[i]) | 0; } return s; },
  function variables() { let s = 0; for (let i = 0; i < 24; i++) { total = total + whole(list[i]); s = s + total; } return s; },
  function bounds() { let s = 0; for (let i = 0; i < bound; i++) { try { s = (s + plus(list[i])) | 0; } catch (error) { s = (s + error.size) | 0; } } return s; },
  function nested(r) { let s = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < 24; i++) { s = (s + whole(list[i]) + rows[r][i]) | 0; } return s; },
  function boxed() { let s = 0; for (let i = 0; i < 24; i++) { try { box.n = box.n + plus(list[i]); } catch (error) { s = s + `${error}`.length; } s = s + box.n; } return s; },
  function stored() { const out = []; for (let i = 0; i < 24; i++) { other[i] = list[i] + 1; try { out[i] = plus(other[i] - 1); } catch (error) { out[i] = String(error).length; } } return out.join() + " " + other.join(); },
  function of() { let s = 0; for (const v of list) { try { s = (s + plus(v)) | 0; } catch (error) { s = (s + String(error).length) | 0; } } return s; },
];
const plans = [
  [() => {}],
  [() => { other = other.map(v => v + 0.5); }, () => {}],
  [() => { other[9] = "nine"; }, () => { other.length = 20; }],
  [() => { list = list.slice(); list[11] = 1.5; }, () => { delete list[13]; }],
  [() => { cells[10].a = 0.25; }, () => { cells[12].c = 1; }, () => { delete cells[19].b; cells[20] = { a: 1, b: 2, sum() { return 70; } }; }],
  [() => { Cell.prototype.sum = function () { return 1000; }; }, () => {}],
  [() => { view = new Uint8Array(5); }, () => { view = new Float64Array(24); }],
  [() => { total = total + 0.5; }, () => { total = "t"; }],
  [() => { bound = 20.5; }, () => { bound = 22; }],
  [() => { rows[1] = [0.5, 1.5]; }, () => { rows = [[1], [2]]; }],
  [() => { box.n = 0.5; }, () => { box.n = "n"; }],
  [() => { Object.defineProperty(list, 14, { get() { return 400; }, configurable: true }); }, () => {}],
];
for (const loop of loops) {
  const lines = [];
  for (const plan of plans) {
    fill(); changes = plan; deeds = 0;
    let first, second;
    try { first = loop(1); } catch (error) { first = error.constructor.name; }
    try { second = loop(0); } catch (error) { second = error.constructor.name; }
    lines.push(first, second, deeds, grown.length);
  }
  console.log(loop.name, lines.join(" "));
}

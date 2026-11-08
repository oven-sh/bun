const unseen = (x) => [x][JSON.parse("0")];
class Card { constructor(id) { this.id = id; this.tag = "born"; this.rest = 1; } }
class Chip { constructor(id) { this.tag = "made"; this.id = id; } }
function put(o, v) { "use strict"; let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o.tag = v; return w; }
function look(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return String(o.tag) + w; }
const name = JSON.parse('"tag"');
let got = 0;
const deeds = [
  (o) => {},
  (o) => { delete o[name]; },
  (o) => { Object.defineProperty(o, name, { value: "fixed", writable: false }); },
  (o) => { Object.defineProperty(o, name, { set(v) { got += 1; }, get() { return "own"; }, configurable: true }); },
  (o) => { Object.freeze(o); },
  (o) => { delete o[name]; Object.preventExtensions(o); },
  (o) => { delete o[name]; Object.setPrototypeOf(o, { set tag(v) { got += 10; }, get tag() { return "up"; } }); },
];
const out = [];
function turn(i) {
  let w = 0; for (let k = 0; k < 2; k++) w = (w + k) | 0;
  const o = unseen(i < 700 && i % 3 === 2 ? JSON.parse('{"id":0}') : i % 2 ? new Card(i) : new Chip(i));
  if (i >= 700) deeds[(i >> 1) % deeds.length](o);
  let said = "ok";
  try { put(o, i); } catch (e) { said = e.name; }
  if (i >= 700) out.push([i, said, Object.keys(o).join("+"), look(o), JSON.stringify(o), got].join("|"));
}
for (let i = 0; i < 714; i++) turn(i);
console.log(out.join("\n"));

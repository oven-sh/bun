const unseen = (x) => [x][JSON.parse("0")];
const kMark = Symbol("mark");
class Leaf { constructor(id) { this.id = id; this[kMark] = "leaf"; } }
class Twig { constructor(id) { this[kMark] = "twig"; this.id = id; } }
class Bare { constructor(id) { this.id = id; } }
function put(o, v) { "use strict"; let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; o[kMark] = v; return w; }
function look(o) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return String(o[kMark]) + w; }
const key = unseen(kMark);
const deeds = [(o) => {}, (o) => { delete o[key]; }, (o) => { Object.freeze(o); }, (o) => { Object.defineProperty(o, key, { value: "fixed", writable: false }); }];
const out = [];
function turn(i) {
  let w = 0; for (let k = 0; k < 2; k++) w = (w + k) | 0;
  const o = unseen(i % 3 === 0 ? new Leaf(i) : i % 3 === 1 ? new Twig(i) : new Bare(i));
  if (i >= 600) deeds[((i - 600) / 3 | 0) % 4](o);
  let said = "ok";
  try { put(o, i); } catch (e) { said = e.name; }
  if (i >= 600) out.push([i, said, Reflect.ownKeys(o).map(String).join("+"), look(o), String(o[key])].join("|"));
}
for (let i = 0; i < 612; i++) turn(i);
console.log(out.join("\n"));

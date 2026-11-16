// Objects of one order, some with an element and some with a name at the same place: a field behind it is listed behind the name.
const lines = [];
const plain = value => ({ value, writable: true, enumerable: true, configurable: true });
function stored(k, i) { const o = {}; o.x = 7; o[k] = 1; o.c = i; o.y = i; return o; }
function numbers(k, i) { const o = {}; o.x = 0.5; o[k] = 1; o.c = i * 0.5; o.y = i * 0.5; return o; }
function texts(k, i) { const o = { x: "a" }; o[k] = 1; o.c = "t" + i; if (i & 1) o.w = "w"; o.y = "y"; return o; }
function Defined(k) { this.port = 1; Object.defineProperty(this, k, plain(1)); this.kind = 2; }
function Described(k) { this.port = 1; Object.defineProperties(this, { [k]: plain(1) }); this.kind = 2; }
function Copied(k) { this.port = 1; Object.defineProperties(this, Object.getOwnPropertyDescriptors({ [k]: 1 })); this.kind = 2; }
function Reflected(k) { this.port = 1; Reflect.defineProperty(this, k, plain(1)); this.kind = 2; this.mode = 3; }
function Assigned(k) { this.port = 1; Object.assign(this, { [k]: 1 }); this.kind = 2; }
function Listed(k) { this.port = 1; for (const key of [k, "host"]) this[key] = 1; this.kind = 2; this.end = 1; }
class Fields { port = 1; constructor(k) { this[k] = 1; this.kind = 2; this.late(k); } late() { this.after = 3; } }
class Below extends Fields { own = 4; constructor(k) { super(k); this[k + "0"] = 1; this.last = 5; } }
const makers = [stored, numbers, texts, ...[Defined, Described, Copied, Reflected, Assigned, Listed, Fields, Below].map(C => k => new C(k))];
const names = ["0", "0", "4", "0", "k2", "0", "zz", "4", "k2", "host", "0", "1", "name", "0", "k2", "toString", "zz", "0"];
for (let round = 0; round < 3; round++) for (const make of makers) for (let i = 0; i < names.length; i++) {
  const o = make(names[i], i + round);
  o.z = 1; if (i % 4 === 1) o[names[(i + 5) % names.length] + "1"] = 2; o.q = i;
  let walked = "";
  for (const k in o) walked += k + ",";
  lines.push([Object.keys(o).join(), walked, JSON.stringify(o), JSON.stringify({ ...o }), Object.entries(o).join(), Reflect.ownKeys(o).join()].join(" | "));
}
console.log(lines.length);
console.log(lines.join("\n"));

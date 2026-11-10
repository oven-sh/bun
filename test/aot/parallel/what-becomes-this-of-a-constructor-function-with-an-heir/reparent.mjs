import { EventEmitter } from "node:events";
class Kept { constructor(x) { this.x = x; } m() { return this.x; } }
function Base(v) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; this.held = v; this.n = w; }
class Heir extends Base { constructor(v) { super(v); this.y = 2; } }
const first = new Kept(JSON.parse("1")), second = new Kept(JSON.parse("2"));
const heir = new Heir(first);
const odd = { a: JSON.parse("11"), b: JSON.parse('"bee"'), c: JSON.parse("13.5"), d: JSON.parse("[14]") };
function Other(v) { this.p = 1; this.q = v; }
class Low extends Other { constructor(v) { super(v); this.r = 3; } }
const low = new Low(first);
function part(p) { return p === first ? "first" : p === second ? "second" : typeof p === "function" ? "fn" : typeof p === "object" && p !== null ? "obj" : String(p); }
function whole(u) { return u === null || (typeof u !== "object" && typeof u !== "function") ? String(u) : Reflect.ownKeys(u).map(k => typeof k === "symbol" ? "@" : k + "=" + part(u[k])).join(","); }
const before = whole(heir);
let made;
try { made = (Object.setPrototypeOf(Heir, Other), new Heir(second)); } catch (e) { made = e.name; }
function say() {
  for (const u of [made, odd]) if (u && u.held === second) u.held.x = JSON.parse('"poked"');
  console.log(`SAID ${before} | ${whole(made)} | ${whole(odd)} | ${whole(heir)} | ${first.m()} ${second.m()} ${part(globalThis.held)} ${typeof EventEmitter}`);
}
say();

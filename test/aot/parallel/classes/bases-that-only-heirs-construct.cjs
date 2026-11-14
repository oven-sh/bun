// Methods of a class that only super() constructs in sight, called with heirs, with objects of the class itself that others construct, and with foreign objects.
"use strict";
const out = [];
let B = {}, H = {};
{ class Base { constructor(x) { this.state = { x, y: 0 }; this.count = 0; } step(n) { this.count += n; this.state.y = this.state.x + this.count; return this.read(); } read() { return this.state.y; } name() { return "base" + this.count; } get twice() { return this.count * 2; } } B = Base; }
{ const Above = B; class Heir extends Above { constructor(x, z) { super(x); this.z = z; } name() { return "heir" + super.name() + this.z; } more() { return this.step(2) + this.twice; } } H = Heir; }
globalThis.kept = [B, H];
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message.slice(0, 40); } out.push(name + " " + String(r)); };
const use = (name, o) => { for (let i = 0; i < 3; i++) { show(name + " step", () => H.prototype.step.call(o, i)); show(name + " read", () => B.prototype.read.call(o)); show(name + " name", () => o.name()); show(name + " twice", () => o.twice); show(name + " more", () => H.prototype.more.call(o)); } show(name + " keys", () => Object.keys(o).join()); };
use("heir", new H(1, 2));
use("base by name", new globalThis.kept[0](3));
use("base by Reflect", Reflect.construct(globalThis.kept[0], [4]));
use("base with new.target", Reflect.construct(globalThis.kept[0], [5], globalThis.kept[1]));
use("bare", Object.create(globalThis.kept[0].prototype));
use("foreign", { state: { x: 1, y: 2 }, count: 3, step: B.prototype.step, read: B.prototype.read, name() { return "own"; } });
use("constructor of object", new (new H(6, 7).constructor)(8, 9));
use("constructor above", new (Object.getPrototypeOf(H))(10));
class Other extends globalThis.kept[0] { step(n) { return super.step(n) * 10; } }
use("other heir", new Other(11));
const changed = new H(12, 13); changed.step = () => "own step"; use("own method", changed);
const deleted = new H(14, 15); delete deleted.state; use("no state", deleted);
Object.setPrototypeOf(changed, globalThis.kept[0].prototype); use("moved", changed);
B.prototype.read = function () { return "new" + this.count; }; use("replaced", new H(16, 17)); use("replaced base", new globalThis.kept[0](18));
let sum = 0; const objects = [new H(1, 1), new globalThis.kept[0](2), new Other(3), Reflect.construct(globalThis.kept[0], [4])];
for (let i = 0; i < 400; i++) { const o = objects[i & 3]; o.step(i & 7); sum += o.count + o.state.y; }
show("sum", () => sum);
for (const line of out) console.log(line);

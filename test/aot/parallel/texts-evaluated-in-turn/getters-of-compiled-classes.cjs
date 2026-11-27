const { fullGC } = require("bun:jsc");
globalThis.collect = () => void fullGC();
globalThis.Point = class { constructor(x, y) { this.x = x; this.y = y; this.kind = "point"; } get left() { return this.x; } get sum() { return this.x + this.y; } get type() { return this.kind; } get self() { return this; } set left(v) { this.x = v; } };
globalThis.Point3 = class extends Point { constructor(x, y, z) { super(x, y); this.z = z; } get depth() { return this.z; } get left() { return super.left + 100; } };
globalThis.Sparse = class { constructor(x) { if (x > 2) this.late = x; this.a = x; } get later() { return this.late; } get twice() { return this.a * 2; } };
const text = `
const lines = [];
const show = v => v && typeof v === "object" ? "o" + Object.keys(v) : String(v);
const attempt = f => { try { lines.push(show(f())); } catch (e) { lines.push(e.name); } };
const objects = [new Point(1, 2), new Point("s", "t"), new Point(1.5, null), new Point3(1, 2, 3), new Sparse(1), new Sparse(5), Object.create(new Point(7, 8)), { left: "own" }, new (class extends Point { get left() { return "text " + super.left; } })(3, 4), new Proxy(new Point(5, 6), {}), Point.prototype, null];
const sites = [o => o.left, o => o.sum, o => o.type, o => o.depth, o => o.later, o => o.twice, o => o.self === o, o => { o.left = 9; return o.x; }, o => { o.x = "changed"; return o.left; }, o => "left" in o, o => o["left"], o => { const { left, sum } = o; return [left, sum].join(); }];
const round = n => { for (let t = 0; t < n; t++) for (const site of sites) for (const o of objects) attempt(() => site(o)); };
round(8);
for (const change of [() => { objects[0].x = undefined; }, () => { delete objects[1].x; }, () => { Object.defineProperty(objects[2], "x", { get() { return "accessor"; }, configurable: true }); }, () => { Object.freeze(objects[3]); }, () => { objects[4].late = "now"; }, () => { delete objects[5].late; }, collect, () => { Object.defineProperty(Point.prototype, "left", { get() { return "replaced"; }, configurable: true }); }, () => { delete Point3.prototype.depth; }, () => { Object.setPrototypeOf(objects[0], { get left() { return "other"; } }); }, () => { Object.defineProperty(Sparse.prototype, "later", { value: "data", configurable: true }); }]) { attempt(() => { change(); return "changed"; }); round(4); }
lines.length + " " + lines.reduce((h, l) => { for (let k = 0; k < l.length; k++) h = (Math.imul(h, 31) + l.charCodeAt(k)) | 0; return h; }, 0) + "\\n" + lines.slice(0, 2000).join("\\n");
`;
for (let t = 0; t < 2; t++) console.log((0, eval)("{" + text + "}"));

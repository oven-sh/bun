// A constructor reads a name of the object it creates. Until a store under the name can have reached the object the read finds what the prototype has.
const out = [];
function show(name, v) { out.push(name + ": " + typeof v + " " + String(v)); }
function boom() { throw 0; }
const W = t => t;

class B1 { constructor() { this.x = 1; } } class D1 extends B1 { constructor() { super(); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D1.prototype.x = "proto"; show("parent stores", new D1().y);
function init2(o) { o.x = 1; } class D2 { constructor() { init2(this); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D2.prototype.x = "proto"; show("helper stores", new D2().y);
class D3 { x = 1; constructor() { const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D3.prototype.x = "proto"; show("field initializer stores", new D3().y);
const k4 = "x"; class D4 { constructor() { this[k4] = 1; const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D4.prototype.x = "proto"; show("computed store", new D4().y);
class D5 { constructor() { Object.assign(this, { x: 1 }); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D5.prototype.x = "proto"; show("assign", new D5().y);
class D6 { constructor() { Object.defineProperty(this, "x", { value: 1 }); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D6.prototype.x = "proto"; show("define", new D6().y);
class D7 { constructor() { Reflect.set(this, "x", 1); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D7.prototype.x = "proto"; show("Reflect.set", new D7().y);
class D8 { set v(a) { this.x = a; } constructor() { this.v = 1; const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D8.prototype.x = "proto"; show("setter stores", new D8().y);
class D9 { constructor() { const f = () => { this.x = 1; }; f(); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D9.prototype.x = "proto"; show("closure stores", new D9().y);
class D10 { constructor() { const r = []; for (let i = 0; i < 2; i++) { const t = this.x; r.push(t === "proto" ? "from prototype" : t + 1); this.x = i; } this.y = r.join(); } } D10.prototype.x = "proto"; show("loop", new D10().y);
class D11 { constructor() { try { this.x = 1; boom(); } catch { const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } } D11.prototype.x = "proto"; show("handler", new D11().y);
class D12 { constructor() { const self = this; self.x = 1; const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D12.prototype.x = "proto"; show("alias", new D12().y);
class D13 { get x() { Object.defineProperty(this, "x", { value: 1 }); return "proto"; } constructor() { const s = this.x; const t = this.x; this.y = (s === "proto" ? "from prototype" : s + 1) + "," + (t === "proto" ? "from prototype" : t + 1); } } show("getter defines", new D13().y);
function init14(o) { o.x = 1; boom(); } class D14 { constructor() { try { init14(this); } catch { } const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D14.prototype.x = "proto"; show("helper stores and throws", new D14().y);
function init15() { arguments[0].x = 1; } class D15 { constructor() { init15(this); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D15.prototype.x = "proto"; show("helper stores through arguments", new D15().y);
class B16 { } class D16 extends B16 { constructor() { super(); super.x = 1; const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D16.prototype.x = "proto"; show("super store", new D16().y);
class B17 { constructor() { return { x: 1 }; } } class D17 extends B17 { constructor() { super(); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D17.prototype.x = "proto"; show("parent returns another object", new D17().y);
class D18 { constructor(c) { if (c) this.x = 1; const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D18.prototype.x = "proto"; show("store on one path", new D18(true).y + "," + new D18(false).y);
class D19 { constructor() { const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; this.x = 1; } } D19.prototype.x = "proto"; show("read first", new D19().y + "," + new D19().x);
class D20 { run() { return this.n; } constructor() { this.n = 1; this.run = this.run.bind(this); } } show("bind", (0, new D20().run)());
class D21 { run() { return "proto"; } constructor() { this.run = () => 1; const t = this.run(); this.y = t === "proto" ? "from prototype" : t + 1; } } show("own closure over method", new D21().y);
class D22 extends Array { constructor() { super(); this.push(7); const t = this.length; this.y = t + 1; } } show("built-in parent", new D22().y);
class D23 extends Error { constructor() { super("m"); const t = this.message; this.y = t + "!"; } } D23.prototype.message = "proto"; show("error parent", new D23().y);
var late24; const T24 = { a(o) { }, undefined(o) { o.x = 1; } };
class D24 { constructor() { T24[late24](this); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D24.prototype.x = "proto"; show("late helper stores", new D24().y); var late24 = "a"; show("late helper stores, after", new D24().y);
var late25; const T25 = { a: class { }, undefined: class { constructor() { this.x = 1; } } };
function mk25() { return class extends T25[late25] { constructor() { super(); const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } }; }
{ const K = mk25(); K.prototype.x = "proto"; show("late parent stores", new K().y); } var late25 = "a"; { const K = mk25(); K.prototype.x = "proto"; show("late parent stores, after", new K().y); }
var late26; const T26 = { a: "w", undefined: "x" };
class D26 { constructor() { this[T26[late26]] = 1; const t = this.x; this.y = t === "proto" ? "from prototype" : t + 1; } } D26.prototype.x = "proto"; show("late key", new D26().y); var late26 = "a"; show("late key, after", new D26().y);

console.log(out.join("\n"));

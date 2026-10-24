// A property that only some objects of a class have, with a property of the same name on the prototype.
const out = [];
function show(name, v) { out.push(name + ": " + typeof v + " " + String(v)); }

class D1 { constructor() { this.a = 1; } }
D1.prototype.z = "proto";
const o1 = new D1(), p1 = new D1();
o1.z = 1;
function rd1(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
show("stored outside", rd1(o1) + "," + rd1(p1));

class D2 { constructor(c) { this.a = 1; if (c) this.z = 1; } }
D2.prototype.z = "proto";
function rd2(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
show("stored on one path", rd2(new D2(true)) + "," + rd2(new D2(false)));

class D3 { constructor(c) { this.a = 1; if (c) this.m = () => 1; } m() { return "proto"; } }
function rd3(q) { const t = q.m(); return t === "proto" ? "from prototype" : t + 1; }
show("method or own closure", rd3(new D3(true)) + "," + rd3(new D3(false)));

class D4 { constructor(c) { if (c) this.z = 1; } get z() { return "proto"; } set z(v) { Object.defineProperty(this, "z", { value: v }); } }
function rd4(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
show("getter or own value", rd4(new D4(true)) + "," + rd4(new D4(false)));

let seen5;
class D5 { constructor() { seen5 = rd5(this); this.z = 1; } }
D5.prototype.z = "proto";
function rd5(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
const o5 = new D5();
show("read before the store", seen5 + "," + rd5(o5));

class B6 { constructor() { this.seen = rd6(this); } }
class D6 extends B6 { z = 1; }
D6.prototype.z = "proto";
function rd6(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
{ const o = new D6(); show("base reads the field of the subclass", o.seen + "," + rd6(o)); }

class D7 { constructor() { this.z = 1; } }
D7.prototype.z = "proto";
const o7 = new D7(); delete o7.z;
function rd7(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
show("deleted", rd7(o7) + "," + rd7(new D7()));

function F8(c) { if (c) this.z = 1; }
F8.prototype.z = "proto";
function rd8(q) { const t = q.z; return t === "proto" ? "from prototype" : t + 1; }
show("constructor function", rd8(new F8(true)) + "," + rd8(new F8(false)));

console.log(out.join("\n"));

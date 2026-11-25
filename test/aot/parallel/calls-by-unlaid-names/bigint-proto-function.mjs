class V { constructor(x) { this.x = x; } combine(o) { return this.x + o.x; } }
const f = function (o) { o.x = "laid"; return 7; };
const value = 3n;
const items = [new V(1), value, new V(2)];
function one(v, arg) { return v.combine(arg); }
function run() { const said = []; for (const v of items) { const arg = new V(5); let r; try { r = one(v, arg); } catch (e) { r = e.constructor.name; } said.push(r, arg.x, arg.x * 2, arg.x + 1); } return said.join(); }
console.log(run());
try { function protoOf(x) { return x.__proto__; } protoOf(value).combine = f; } catch (e) { console.log("laying threw", e.constructor.name); }
console.log(run());
for (let i = 0; i < 200; i++) run();
console.log(run());

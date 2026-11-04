const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
function G(y) { this.y = y; }
function is(v) { return v instanceof F ? 1 : 0; }
function isG(v) { return v instanceof G ? 1 : 0; }
function all(list) { let t = ""; for (let i = 0; i < list.length; i++) t += is(list[i]) + "" + isG(list[i]); return t; }
const make = () => [new F(1), new G(2), { x: 1 }, null, undefined, 5, "s", [], function () { }, Object.create(null)];
const kept = make(); console.log(attempt(() => all(kept))); Object.setPrototypeOf(F.prototype, G.prototype); console.log(attempt(() => all(kept)));

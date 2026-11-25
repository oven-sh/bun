const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : typeof v === "function" ? "function " + v.name : v); } catch (e) { return String(e); } };

function twice(x) { return x * 2; }
function isOdd(x) { return x % 2 === 1; }
function run(held) { return held.map(twice); }
function pickOdd(held) { return held.filter(isOdd); }
class Box { constructor(v) { this.v = v; } map(f) { return new Box(f(this.v)); } filter(f) { return f(this.v) ? this : null; } }
class Rows extends Array { map(f) { return "own map " + super.map(f).join("+"); } }
const many = [[1, 2, 3], new Box(21), new Uint8Array([1, 200, 3]), new Float64Array([0.5, 1.5]), Rows.from([1, 2]), { map: f => "plain object " + f(4), filter: f => f(3) }, new Map([[1, 2]]).keys().map ? "iterator helpers" : "none"];
for (let t = 0; t < 2; t++) for (const held of many) { if (typeof held === "string") continue; const a = run(held), b = pickOdd(held); console.log(held.constructor.name, say(a instanceof Box ? a.v : ArrayBuffer.isView(a) ? Array.from(a) : a), say(b instanceof Box ? b.v : ArrayBuffer.isView(b) ? Array.from(b) : b)); }
for (const bad of [null, undefined, 5, "text", {}]) { try { console.log(say(run(bad))); } catch (e) { console.log(e.constructor.name); } }

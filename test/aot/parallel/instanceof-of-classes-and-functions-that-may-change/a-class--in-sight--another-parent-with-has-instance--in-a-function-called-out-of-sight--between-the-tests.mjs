const marks = []; function mark(text) { marks.push(text); }
class Shelf { constructor(n) { this.n = n; } }
class Crate { constructor(n) { this.n = n; } }

function pick(what) { return [what][marks.length & 0]; }
function is(value) { return value instanceof Shelf; }
globalThis.asked = is;
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (globalThis.asked(list[i])) hits += 1 << i; return hits; }
const things = [7, new Shelf(1), new Crate(2), Object.create(Shelf.prototype), { n: 3 }, null, undefined, "text", Shelf, Object.create(null), new Proxy(new Shelf(4), {}), function () {}];
function tell(when) { let told; try { told = count(things); } catch (error) { told = "threw " + error.constructor.name; } console.log(when, told, marks.splice(0).join(" . ")); }
tell("first"); tell("again"); const parent = function () {}; Object.defineProperty(parent, Symbol.hasInstance, { value() { mark("asked the parent"); return true; } }); Object.setPrototypeOf(pick(Shelf), parent); tell("behind the deed"); tell("again");

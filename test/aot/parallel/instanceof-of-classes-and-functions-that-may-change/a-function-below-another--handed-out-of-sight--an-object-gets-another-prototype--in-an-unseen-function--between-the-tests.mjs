const marks = []; function mark(text) { marks.push(text); }
function Rack(n) { this.n = n; }
function Shelf(n) { Rack.call(this, n); this.m = n; }
Object.setPrototypeOf(Shelf, Rack);
Shelf.prototype = Object.create(Rack.prototype);
function Crate(n) { Rack.call(this, n); }
Object.setPrototypeOf(Crate, Rack);
Crate.prototype = Object.create(Rack.prototype);
globalThis.kept = [Shelf, Crate]; JSON.stringify(globalThis.kept);
function pick(what) { return [what][marks.length & 0]; }
function is(value) { return value instanceof Shelf; }
globalThis.asked = is;
function count(list) { let hits = 0; for (let i = 0; i < list.length; i++) if (globalThis.asked(list[i])) hits += 1 << i; return hits; }
const things = [7, new Shelf(1), new Crate(2), Object.create(Shelf.prototype), { n: 3 }, null, undefined, "text", Shelf, Object.create(null), new Proxy(new Shelf(4), {}), function () {}, new Rack(5)];
function tell(when) { let told; try { told = count(things); } catch (error) { told = "threw " + error.constructor.name; } console.log(when, told, marks.splice(0).join(" . ")); }
tell("first"); tell("again"); Object.setPrototypeOf(things[1], pick(Crate).prototype); Object.setPrototypeOf(things[2], pick(Shelf).prototype); tell("behind the deed"); tell("again");

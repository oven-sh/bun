const marks = []; function mark(text) { marks.push(text); }
function Rack(n) { this.n = n; }
function Shelf(n) { Rack.call(this, n); this.m = n; }
Object.setPrototypeOf(Shelf, Rack);
Shelf.prototype = Object.create(Rack.prototype);
function Crate(n) { Rack.call(this, n); }
Object.setPrototypeOf(Crate, Rack);
Crate.prototype = Object.create(Rack.prototype);
globalThis.kept = [Shelf, Crate];
function pick(index) { return globalThis.kept[index + (marks.length & 0)]; }
function count(list, Kind) { let hits = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof Kind) hits += 1 << i; return hits; }
function is(value, Kind) { return value instanceof Kind; }
const first = new Shelf(1);
const things = [7, first, new Crate(2), Object.create(Object.getPrototypeOf(first)), { n: 3 }, null, undefined, "text", Shelf, Object.create(null), new Proxy(first, {}), function () {}];
function tell(when) {
  let told;
  try { told = count(things, pick(0)) + " " + count(things, pick(1)) + " " + is(things[1], pick(0)) + " " + is(things[2], pick(0)); } catch (error) { told = "threw " + error.constructor.name + ": " + error.message; }
  console.log(when, told, marks.splice(0).join(" . "));
}
tell("first"); tell("again"); tell("a third time");
Object.defineProperty(Rack, Symbol.hasInstance, { value: Function.prototype[Symbol.hasInstance], writable: true, configurable: true }); tell("between"); tell("between again"); tell("between a third time"); Rack[Symbol.hasInstance] = function (value) { mark("asked"); return value === 7; };
tell("behind the deed"); tell("again"); tell("a third time");

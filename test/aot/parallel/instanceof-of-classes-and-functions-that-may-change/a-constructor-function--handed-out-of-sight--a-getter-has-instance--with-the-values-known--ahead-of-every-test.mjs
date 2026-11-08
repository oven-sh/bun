const marks = []; function mark(text) { marks.push(text); }
function Shelf(n) { this.n = n; }
function Crate(n) { this.n = n; }
globalThis.kept = [Shelf, Crate]; JSON.stringify(globalThis.kept);
function pick(what) { return [what][marks.length & 0]; }
function count(list) { let hits = 0; const a = new Shelf(1), b = new Crate(2); if (a instanceof Shelf) hits += 1; if (b instanceof Shelf) hits += 2; for (let i = 0; i < list.length; i++) if (list[i] instanceof Shelf) hits += 4 << i; return hits; }
const things = [7, new Shelf(1), new Crate(2), Object.create(Shelf.prototype), { n: 3 }, null, undefined, "text", Shelf, Object.create(null), new Proxy(new Shelf(4), {}), function () {}];
function tell(when) { let told; try { told = count(things); } catch (error) { told = "threw " + error.constructor.name; } console.log(when, told, marks.splice(0).join(" . ")); }
Object.defineProperty(pick(Shelf), Symbol.hasInstance, { get() { mark("read"); return undefined; }, configurable: true }); tell("behind the deed"); tell("again");

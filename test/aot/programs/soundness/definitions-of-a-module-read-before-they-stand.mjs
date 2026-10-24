// The variables of a module get their values where the definitions stand. Hoisted functions that run earlier find them uninitialized, also when the value is an object that costs nothing to make.
const log = [];
const attempt = (name, f) => { try { log.push(name + ": " + f()); } catch (e) { log.push(name + ": " + e.name); } };
function all(when) {
  attempt(when + " table", () => table.a);
  attempt(when + " list", () => list.length);
  attempt(when + " helper", () => helper());
  attempt(when + " class", () => new Thing().n);
  attempt(when + " pattern", () => pattern.test("a"));
  attempt(when + " symbol", () => mark.description);
  attempt(when + " map", () => byName.size);
  attempt(when + " typeof table", () => typeof table);
  attempt(when + " var", () => String(early));
  attempt(when + " declared function", () => declared());
  attempt(when + " exported", () => shared.n);
}
all("before");
const table = { a: 1 };
const list = [1, 2];
const helper = () => 5;
class Thing { n = 1; }
const pattern = /a/;
all("between");
const mark = Symbol("mark");
const byName = new Map();
var early = [1];
function declared() { return "declared"; }
export const shared = { n: 7 };
all("after");
let count = 1;
const box = { count };
const snapshot = [count, table.a];
count = 2;
table.a = 3;
log.push("moment: " + [box.count, snapshot, count, table.a].join());
console.log(log.join("\n"));

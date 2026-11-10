// Handlers lie in lists in a table that is born empty and filled under names. One handler is fired in a hot loop; then the guess on it is made to fail in every way:
// another handler under the same name, one added while the list is stepped through, a name without handlers, a text and a number laid under a name, a list with a hole, a handler that throws.
class Hub {
  constructor() { this.handlers = {}; }
  on(name, fn) { (this.handlers[name] || (this.handlers[name] = [])).push(fn); return this; }
  fire(name, a, b) { const list = this.handlers[name]; if (list) for (const handler of list) handler(a, b); return list ? list.length : -1; }
  call(name, a, b) { const list = this.handlers[name]; if (list) for (const handler of list) handler.call(this, a, b); }
  apply(name, ...args) { const list = this.handlers[name]; if (list) for (const handler of list) handler.apply(this, args); }
}
const hub = new Hub(); let total = 0;
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
hub.on("tick", (item, by) => { total = (total + item.size * by) | 0; });
function turn(t) { for (let i = 0; i < 300; i++) hub.fire("tick", { size: i + t }, 2); return total; }
console.log("one", turn(1), turn(2));
for (let i = 0; i < 300; i++) { hub.call("tick", { size: i }, 3); hub.apply("tick", { size: i }, 1); }
console.log("call and apply", total);
hub.on("tick", function (item) { total = (total - item.size) | 0; });
console.log("two", turn(3), hub.fire("none", {}, 0));
let grown = 0; hub.on("grows", () => { if (grown++ < 3) hub.on("grows", () => { total += 1000; }); });
console.log("grows", hub.fire("grows"), hub.fire("grows"), total);
const names = JSON.parse('["text","number","holes","throws","tick"]');
hub.handlers[names[0]] = "ab"; hub.handlers[names[1]] = 7; hub.handlers[names[2]] = [, () => { total += 5; }];
hub.on(names[3], () => { throw new RangeError("no"); });
for (const name of names) console.log(name, attempt(() => hub.fire(name, { size: 1 }, 1)), attempt(() => hub.call(name, { size: 1 }, 1)), attempt(() => hub.apply(name, { size: 1 }, 1)), total);

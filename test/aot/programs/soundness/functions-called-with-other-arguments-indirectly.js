// Functions called with other argument types or counts through call, apply, bind, host callbacks, computed names.
function add(a, b) { return a + b; }
console.log(add(1, 2));
console.log(add.call(null, "1", 2), add.apply(null, [1]), add.bind(null, 1.5)(2), Reflect.apply(add, null, [{}, 1]));
const table = { add, neg(x) { return -x; } };
const name = JSON.parse('"neg"');
console.log(table[name]("3"), table[name](), Object.is(table[name](0), -0));
function inc(x) { return x + 1; }
console.log([1, "2", null, undefined, 3n].map(v => { try { return String(inc(v)); } catch (e) { return e.name; } }).join());
console.log(["1", "2", "3"].map(parseInt).join(), [1, 2, 3].map(inc).join());
function opt(a, b = a * 2, ...rest) { return [a, b, rest.length, arguments.length].join(); }
console.log(opt(1), opt(1, undefined, 3), opt(), opt.length);
function sloppy(a) { arguments[0] = "changed"; return a; }
console.log(sloppy(1), sloppy());
setTimeout(inc, 0, "late");
setTimeout((a, b) => console.log("timer", a, typeof b), 0, 5);
Promise.resolve("p").then(inc).then(console.log);
queueMicrotask(() => console.log("micro", inc(1)));
const { EventEmitter } = require("node:events");
const em = new EventEmitter();
function on(x) { console.log("event", x * 2, typeof x); }
em.on("e", on); em.emit("e", 2); em.emit("e", "3"); em.emit("e");
function ctor(v) { this.v = v; } ctor.prototype.get = function () { return this.v + 1; };
console.log(new ctor(1).get(), new ctor("1").get(), Reflect.construct(ctor, [2]).get(), ctor.prototype.get.call({ v: 10 }));
const bound = ctor.prototype.get.bind({ v: "b" }); console.log(bound());

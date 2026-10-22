// Function.prototype.call where the compiler does not see which function is called: the callee is a parameter of a function that anybody may call, `call` itself is taken as a value,
// handed to Reflect.apply, bound, called through itself. With no argument up to more than fit in registers; callees of every kind; receivers that cannot be called.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 3; turn++) {
    try {
      seen.push(String(JSON.stringify(run(turn)) ?? "undefined"));
    } catch (error) {
      seen.push(error.constructor.name + (error instanceof RangeError ? ": " + error.message : ""));
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const describe = value => (value === undefined ? "undefined" : value === null ? "null" : value === globalThis ? "globalThis" : typeof value === "object" ? "object " + Object.prototype.toString.call(value) + " " + String(value.valueOf()) : typeof value + " " + String(value));

function sloppy() { return [describe(this), arguments.length, ...arguments]; }
function strict() { "use strict"; return [describe(this), arguments.length, ...arguments]; }
function three(a, b, c) { "use strict"; return [describe(this), a, b, c]; }
function rest(first, ...others) { "use strict"; return [describe(this), first, others]; }
function defaults(a = "A", b = a + "B") { "use strict"; return [describe(this), a, b]; }
const arrow = (...all) => ["arrow", all];
const method = { name: "holder", m(a, b) { return [this === undefined ? "undefined" : this.name, a, b]; } }.m;
class Base { constructor() { this.made = true; } static s(a) { return [this === Base, a]; } get g() { return "getter of " + this.name; } }
async function later(a, b) { return [describe(this), a, b]; }
function* steps(a, b) { yield describe(this); yield a; yield b; }
const bound = strict.bind("bound this", "bound argument");
function thrower(a) { "use strict"; throw new RangeError("thrown with " + a + " under " + describe(this)); }
const proxied = new Proxy(strict, {});
const trapped = new Proxy(strict, { apply: (target, self, list) => ["trap", describe(self), list] });

const callers = {
  member0: f => f.call(),
  member1: f => f.call("T"),
  member2: f => f.call("T", 1),
  member3: f => f.call("T", 1, 2),
  member4: f => f.call("T", 1, 2, 3),
  member5: f => f.call("T", 1, 2, 3, 4),
  member6: f => f.call("T", 1, 2, 3, 4, 5),
  member9: f => f.call("T", 1, 2, 3, 4, 5, 6, 7, 8),
  spread: f => f.call(...["T", 1, 2, 3]),
  spreadMany: f => f.call("T", ...Array.from({ length: 40 }, (_, i) => i)),
  undefinedThis: f => f.call(undefined, 1),
  nullThis: f => f.call(null, 1),
  numberThis: f => f.call(7, 1),
  objectThis: f => f.call({ name: "given", valueOf: () => "given" }, 1, 2),
};
globalThis.callersForAnybody = callers;
const callees = { sloppy, strict, three, rest, defaults, arrow, method, bound, proxied, trapped, "a static method": Base.s, "a native function": Array.prototype.concat, "Math.max": Math.max, "String.prototype.slice": String.prototype.slice };
for (const [calleeName, callee] of Object.entries(callees))
  for (const [callerName, caller] of Object.entries(globalThis.callersForAnybody))
    show(calleeName + " by " + callerName, () => caller(callee));

const call = Function.prototype.call;
show("call has its name and length", () => [call.name, call.length, typeof call, Object.getOwnPropertyNames(call).sort(), "prototype" in call]);
show("call through call", () => [call.call(strict, "T", 1, 2), call.call(call, strict, "T", 1), call.call(call, call, strict, "T", 1)]);
show("call through apply", () => [call.apply(strict, ["T", 1, 2]), call.apply(strict, []), call.apply(strict), call.apply(strict, ["T", 1, 2, 3, 4, 5, 6, 7])]);
show("call through Reflect.apply", () => [Reflect.apply(call, strict, ["T", 1]), Reflect.apply(call, three, ["T", 1, 2, 3, 4, 5, 6])]);
show("call that is bound", () => [call.bind(strict)("T", 1), call.bind(strict, "T")(1, 2), call.bind(strict, "T", 1, 2, 3, 4, 5)(6)]);
show("call as a callback", () => [[strict, three].map(call, strict).length, ["a", "b"].map(Function.prototype.call, String.prototype.toUpperCase)]);
show("call kept in an object", () => { const o = { f: strict, call }; return [o.call === call, o.f.call(o.f.name, 1)]; });
show("a function with its own call", () => { const f = function () { return "body"; }; f.call = (...all) => ["own call", all]; return globalThis.callersForAnybody.member3(f); });
show("an object with a call that is no function", () => globalThis.callersForAnybody.member2({ call: (...all) => ["a member named call", all] }));
for (const [name, value] of Object.entries({ "an object": {}, "a number": 1, "a string": "s", undefined, null: null, "a symbol": Symbol.iterator, "an array": [], "a class": Base, "a derived class": class extends Base {} })) {
  show("call on " + name + " with nothing", () => call.call(value));
  show("call on " + name + " with three", () => call.call(value, "T", 1, 2));
  show("call on " + name + " with nine", () => call.call(value, "T", 1, 2, 3, 4, 5, 6, 7, 8));
}
show("new call", () => new call());
show("the callee throws", turn => globalThis.callersForAnybody["member" + (turn + 1)](thrower));
show("a generator", () => [...globalThis.callersForAnybody.member3(steps)]);
show("a getter's function", () => globalThis.callersForAnybody.objectThis(Object.getOwnPropertyDescriptor(Base.prototype, "g").get));
show("arguments are evaluated in order, before the callee is tested", () => { const order = []; try { globalThis.callersForAnybody.order = f => f.call((order.push("this"), "T"), (order.push("first"), 1), (order.push("second"), 2)); globalThis.callersForAnybody.order(3); } catch (error) { order.push(error.constructor.name); } return order; });
show("deep", () => { "use strict"; function down(n) { return n === 0 ? describe(this) : down.call(this, n - 1); } return globalThis.callersForAnybody.member2.call(null, { call: (self, n) => down.call(self, 2000 + n) }); });
const waited = [];
for (const name of ["member1", "member3", "member6"]) waited.push(globalThis.callersForAnybody[name](later).then(value => name + ": " + JSON.stringify(value)));
Promise.all(waited).then(all => { lines.push("an async function: " + all.join(" | ")); console.log(lines.join("\n")); });

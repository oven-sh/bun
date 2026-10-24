console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function remember(value) {
  this.remembered = value;
  return typeof this.remembered;
}
function count() {
  this.counter = (this.counter || 0) + 1;
  return this.counter;
}
function collect(item) {
  if (!this.collected) this.collected = [];
  return this.collected.push(item);
}

var honest = {};
var sum = 0;
for (var i = 0; i < 2000; i++) sum += remember.call(honest, i).length + count.call(honest) + collect.call(honest, i);
console.log("sum", sum);

attempt("remember", () => remember([1, 2]));
attempt("count", () => [count(), count(), count()]);
attempt("collect", () => [collect("a"), collect("b")]);
attempt("the names as variables", () => [typeof remembered, typeof counter, typeof collected]);
attempt("the variable is used", () => remembered.length + counter + collected.length);
attempt("members of the global object", () => [globalThis.remembered, globalThis.counter, globalThis.collected]);
globalThis.counter = "7";
globalThis.collected = { push: () => "own push" };
attempt("count after a text was stored", () => count());
attempt("collect after an object was stored", () => collect("c"));
attempt("removed", () => [delete globalThis.remembered, delete globalThis.counter, delete globalThis.collected]);
attempt("the names afterwards", () => [typeof remembered, typeof counter, typeof collected]);
attempt("honest again", () => [remember.call(honest, 1), count.call(honest), collect.call(honest, 1)]);

export {};

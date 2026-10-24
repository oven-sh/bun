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

var removals = {
  member: object => [delete object.a, "a" in object],
  computed: object => [delete object["a".trim()], "a" in object],
  element: object => [delete object[0], 0 in object],
  length: object => [delete object.length, "length" in object],
  absent: object => delete object.absent,
  prototype: object => [delete object.prototype, "prototype" in object],
  name: object => [delete object.name, "name" in object],
};
var makers = {
  open: () => ({ a: 1, 0: "zero", length: 1, prototype: 1, name: "n" }),
  frozen: () => Object.freeze({ a: 1, 0: "zero", length: 1, prototype: 1, name: "n" }),
  sealed: () => Object.seal({ a: 1, 0: "zero" }),
  fixed: () => Object.defineProperty({}, "a", { value: 1 }),
  list: () => ["zero"],
  frozenList: () => Object.freeze(["zero"]),
  text: () => "zero",
  boxedText: () => new String("zero"),
  typed: () => new Uint8Array(1),
  aFunction: () => function named() {},
  anArrow: () => () => {},
  aClass: () => class Named {},
  refusingProxy: () => new Proxy({ a: 1 }, { deleteProperty: () => false }),
  inherited: () => Object.create({ a: 1 }),
  operands: () =>
    (function () {
      return arguments;
    })("zero"),
};
for (var i = 0; i < 2000; i++) for (var removal in removals) removals[removal]({ a: i, 0: 1, length: 1 });
for (var maker in makers) for (var removal in removals) attempt(removal + "(" + maker + ")", removals[removal].bind(null, makers[maker]()));
attempt("a constant of Math", () => [delete Math.PI, Math.PI > 3]);
attempt("undefined of the global object", () => delete globalThis.undefined);

export {};

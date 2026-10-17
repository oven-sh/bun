const log = [];
const show = value => (Array.isArray(value) ? "[" + value.map(show).join(",") + "]" : value === undefined ? "undefined" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

function rest(...all) {
  return all;
}
function restAfterTwo(a, b, ...more) {
  return [a, b, more];
}
function count() {
  return arguments.length;
}
function pick(index) {
  return arguments[index];
}
function sum() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i];
  return total;
}
function escape() {
  return arguments;
}
function slice() {
  return Array.prototype.slice.call(arguments, 1);
}
function mapped(a, b) {
  arguments[0] = "changed";
  b = "assigned";
  return [a, b, arguments[0], arguments[1], arguments.length];
}
function sixParameters(a, b, c, d, e, f) {
  return [a, b, c, d, e, f];
}
function defaults(a = "A", b = a + "B", ...more) {
  return [a, b, more, arguments.length];
}
function inArrow() {
  return (() => arguments.length + ":" + arguments[0])();
}
function captured(...all) {
  return () => all;
}
function forward() {
  return rest.apply(this, arguments);
}
function forwardSpread(...all) {
  return restAfterTwo(...all);
}
function forwardTwice() {
  return forward.apply(null, arguments);
}
function recursive(n, ...all) {
  return n ? recursive(n - 1, n, ...all) : all;
}
function firstOrDefault() {
  return arguments.length > 0 ? arguments[0] : "none";
}
function secondAndFourth() {
  return [arguments[1], arguments[3], arguments.length];
}
function overloaded(name, value) {
  if (arguments.length === 1) return "get " + name;
  if (arguments.length === 2) return "set " + name + "=" + value;
  return "other " + arguments.length;
}
function restLengthOnly(...all) {
  return all.length;
}
function restFirst(...all) {
  return all[0];
}
function usesThis() {
  return [this && this.tag, arguments.length];
}
function Built(...all) {
  this.all = all;
  this.count = arguments.length;
}
class Base {
  constructor(...all) {
    this.all = all;
  }
  method(...all) {
    return [this.all.length, all];
  }
  static make() {
    return new this(...arguments);
  }
}
class Derived extends Base {
  constructor() {
    super(...arguments);
    this.derived = arguments.length;
  }
}
function* generator(...all) {
  yield all.length;
  yield* all;
}
async function asynchronous() {
  const before = arguments.length;
  await null;
  return [before, arguments.length, arguments[1]];
}

const functions = { rest, restAfterTwo, count, pick, sum, slice, mapped, sixParameters, defaults, inArrow, forward, forwardSpread, forwardTwice, firstOrDefault, secondAndFourth, overloaded, restLengthOnly, restFirst, usesThis };
const lists = [[], [1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7], [undefined], [undefined, undefined], [0, "x", null, {}]];
const receiver = { tag: "receiver" };

for (let round = 0; round < 3; round++) {
  for (const name of Object.keys(functions)) {
    const f = functions[name];
    log.push(name + " plain " + [f(), f(1), f(1, 2), f(1, 2, 3), f(1, 2, 3, 4), f(1, 2, 3, 4, 5), f(1, 2, 3, 4, 5, 6, 7)].map(show).join(" "));
    log.push(name + " method " + [functions[name](), functions[name](1), functions[name](1, 2, 3, 4), functions[name](1, 2, 3, 4, 5)].map(show).join(" "));
    log.push(name + " spread " + lists.map(list => show(f(...list))).join(" "));
    log.push(name + " apply " + lists.map(list => show(f.apply(receiver, list))).join(" "));
    log.push(name + " call " + [f.call(receiver), f.call(receiver, 1), f.call(receiver, 1, 2, 3, 4), f.call(receiver, 1, 2, 3, 4, 5)].map(show).join(" "));
    log.push(name + " bound " + [f.bind(receiver)(), f.bind(receiver, 1)(2), f.bind(receiver, 1, 2)(3, 4), f.bind(receiver, 1, 2, 3)(4, 5, 6)].map(show).join(" "));
    log.push(name + " reflect " + lists.map(list => show(Reflect.apply(f, receiver, list))).join(" "));
    log.push(name + " callback " + show([5, 6].map(f)));
  }
  log.push("direct rest " + [rest(), rest(1), rest(1, 2), rest(1, 2, 3), rest(1, 2, 3, 4), rest(1, 2, 3, 4, 5), rest(undefined), rest(round, "x", null, {})].map(show).join(" "));
  log.push("direct restAfterTwo " + [restAfterTwo(), restAfterTwo(1), restAfterTwo(1, 2), restAfterTwo(1, 2, 3), restAfterTwo(1, 2, 3, 4), restAfterTwo(1, 2, 3, 4, 5, 6)].map(show).join(" "));
  log.push("direct restLengthOnly " + [restLengthOnly(), restLengthOnly(1), restLengthOnly(1, 2, 3, 4), restLengthOnly(1, 2, 3, 4, 5), restLengthOnly(undefined, undefined)].map(show).join(" "));
  log.push("direct restFirst " + [restFirst(), restFirst(round), restFirst("a", "b"), restFirst(1, 2, 3, 4), restFirst(1, 2, 3, 4, 5), restFirst(undefined, 1)].map(show).join(" "));
  log.push("direct defaults " + [defaults(), defaults(1), defaults(1, 2), defaults(1, 2, 3), defaults(undefined, undefined, 3, 4), defaults(1, 2, 3, 4, 5)].map(show).join(" "));
  log.push("direct forwardSpread " + [forwardSpread(), forwardSpread(1), forwardSpread(1, 2, 3), forwardSpread(1, 2, 3, 4, 5)].map(show).join(" "));
  log.push("direct arguments " + [count(), count(1), count(1, 2, 3, 4), count(1, 2, 3, 4, 5), firstOrDefault(), firstOrDefault(round), secondAndFourth(1, 2, 3, 4), secondAndFourth(1), overloaded("n"), overloaded("n", 1), overloaded(), sum(1, 2, 3), sum(1, 2, 3, 4, 5)].map(show).join(" "));
  const kept = [escape(), escape(1), escape(1, 2, 3, 4), escape(1, 2, 3, 4, 5, 6)];
  rest(9, 9, 9, 9);
  sum(8, 8, 8, 8);
  log.push("escaped " + kept.map(a => a.length + ":" + Array.from(a).join()).join(" "));
  const closures = [captured(), captured(1, 2), captured(1, 2, 3, 4, 5)];
  rest(7, 7, 7, 7);
  log.push("captured " + closures.map(c => show(c())).join(" "));
  log.push("recursive " + show(recursive(0)) + " " + show(recursive(3)) + " " + show(recursive(6, "end")));
  log.push("new " + [new Built(), new Built(1), new Built(1, 2, 3, 4), new Built(1, 2, 3, 4, 5)].map(show).join(" "));
  log.push("classes " + [new Base(), new Base(1, 2), new Derived(), new Derived(1, 2, 3), new Derived(1, 2, 3, 4, 5), Base.make(1, 2), Derived.make(1, 2, 3, 4, 5)].map(show).join(" "));
  log.push("methods " + [new Base(1).method(), new Base(1).method(2), new Derived(1, 2).method(3, 4, 5, 6), new Derived().method(1, 2, 3, 4, 5)].map(show).join(" "));
  log.push("generator " + show([...generator()]) + " " + show([...generator(1, 2)]) + " " + show([...generator(1, 2, 3, 4, 5)]));
}

function deep(n) {
  return n ? deep(n - 1, n) + arguments.length : 0;
}
log.push("deep " + deep(3000));
let overflow;
try {
  (function forever() {
    return forever(...arguments) + arguments.length;
  })(1, 2, 3);
} catch (error) {
  overflow = error.constructor.name;
}
log.push("overflow " + overflow);

Promise.all([asynchronous(), asynchronous(1, 2), asynchronous(1, 2, 3, 4, 5)]).then(values => {
  log.push("async " + show(values));
  console.log(log.join("\n"));
});

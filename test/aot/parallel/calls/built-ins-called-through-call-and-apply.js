// `has.call(o, k)`, `Object.prototype.toString.call(x)`, `slice.call(arguments, 1)`, `Math.max.apply(null, list)`: how packages without types call the functions of the language.
// The call is forwarded to the built-in, and goes by its rows as a call that is written out does. What it answers, refuses and runs on the way is what the function itself does.
// COUNT: operation:operationAOTObjectToStringOfAnyValue >= 14
// COUNT: operation:operationAOTPropertyIsEnumerable >= 8
var has = Object.prototype.hasOwnProperty, listed = Object.prototype.propertyIsEnumerable, toString = Object.prototype.toString, slice = Array.prototype.slice;
const log = [];
const say = (...parts) => console.log(parts.map(String).join(" | "));
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name + ": " + error.message; } };
// A call in tail position leaves no frame behind, and the message of an error quotes the text of the frame below: no call that may throw stands there.
const keep = value => value;
let nothing;

const key = name => ({ toString() { log.push("key " + name); return name; } });
const hidden = Object.defineProperty({ shown: 1 }, "hidden", { value: 2, enumerable: false });
const watched = new Proxy({ a: 1 }, {
  getOwnPropertyDescriptor(target, name) { log.push("descriptor of " + String(name)); return Reflect.getOwnPropertyDescriptor(target, name); },
  has(target, name) { log.push("has " + String(name)); return name in target; },
});
const mark = Symbol("mark");
const receivers = [{ a: 1 }, hidden, [7, 8], "text", 5, true, mark, 10n, function named() {}, Object.create({ a: 1 }), Object.create(null), watched, new Map(), /x/, new Date(0), null, undefined];
const names = ["a", "shown", "hidden", "0", "length", "name", 0, 1, mark, null, undefined];

for (const receiver of receivers) {
  say(attempt(() => keep(toString.call(receiver))), attempt(() => keep(Object.prototype.toString.call(receiver))));
  say(names.map(name => attempt(() => keep(has.call(receiver, name)))).join(" "));
  say(names.map(name => attempt(() => keep(Object.prototype.hasOwnProperty.call(receiver, name)))).join(" "));
  say(names.map(name => attempt(() => keep(listed.call(receiver, name)))).join(" "));
  say(names.map(name => attempt(() => keep(Object.prototype.propertyIsEnumerable.call(receiver, String(name))))).join(" "));
}
say(log.join(", "));
log.length = 0;

// The key is converted in front of the receiver.
say(attempt(() => keep(has.call(null, key("first")))), attempt(() => keep(listed.call(nothing, key("second")))), attempt(() => keep(Object.hasOwn(null, key("never")))), log.join(", "));
say(attempt(() => keep(has.call({ x: 1 }, key("x")))), attempt(() => keep(has.call({ x: 1 }, { toString() { throw new RangeError("no key"); } }))));

function rest() { return slice.call(arguments, 1); }
function all() { return Array.prototype.slice.call(arguments); }
function last() { return Array.prototype.slice.call(arguments, -1)[0]; }
say(JSON.stringify(rest(1, 2, 3)), JSON.stringify(rest()), JSON.stringify(all("a", "b")), last(4, 5, 6));
say(Array.prototype.indexOf.call("abc", "b"), Array.prototype.indexOf.call({ length: 2, 0: "x", 1: "y" }, "y"), Array.prototype.join.call({ length: 2, 0: "a", 1: "b" }, "-"), Array.prototype.join.call("xyz", "+"));
say(attempt(() => keep(Array.prototype.join.call(null))), attempt(() => keep(Array.prototype.indexOf.call(nothing, 1))));
say(Array.prototype.map.call("ab", letter => letter + letter).join(), Array.prototype.filter.call([1, 2, 3], n => n & 1).join(), Array.prototype.some.call({ length: 1, 0: 0 }, n => n === 0));
const grown = [1];
say(Array.prototype.push.apply(grown, [2, 3]), Array.prototype.push.call(grown, 4), grown.join());
say(Math.max.apply(null, [1, 5, 3]), Math.max.apply(Math, []), Math.min.call(null, 4, 2), Math.max.apply(null, [1, key("9")]), log.join(", "));
say(String.prototype.trim.call("  x "), String.prototype.slice.call("hello", 1, 3), String.prototype.toUpperCase.call(12), attempt(() => keep(String.prototype.trim.call(null))), String.fromCharCode.apply(null, [104, 105]));
say(Number.prototype.toFixed.call(1.255, 1), attempt(() => keep(Number.prototype.toFixed.call("1", 1))), Symbol.prototype.toString.call(mark), attempt(() => keep(Symbol.prototype.toString.call("mark"))));
say(Reflect.apply(has, { x: 1 }, ["x"]), Reflect.apply(toString, [], []), attempt(() => keep(Reflect.apply(has, null, ["x"]))).split(":")[0], Reflect.apply(Math.max, null, [1, 2]));
say(Function.prototype.call.call(has, { x: 1 }, "x"), has.call.call(toString, null), Function.prototype.apply.call(Math.max, null, [3, 4]), toString.call(), attempt(() => keep(has.call())), has.call({ undefined: 1 }));
say(toString.apply(null), toString.apply(undefined, []), toString.apply([], null), attempt(() => keep(toString.apply([], 1))), has.apply({ x: 1 }, ["x", "more"]), has.apply({ x: 1 }, { length: 1, 0: "x" }));

// A tag of its own, and one that a getter gives.
say(toString.call({ [Symbol.toStringTag]: "Own" }), toString.call({ get [Symbol.toStringTag]() { log.push("tag"); return "Given"; } }), toString.call({ [Symbol.toStringTag]: 1 }), log.join(", "));
let sum = 0;
for (let i = 0; i < 1000; i++) sum += has.call(hidden, i & 1 ? "shown" : "absent") + listed.call(hidden, i & 2 ? "hidden" : "shown") + toString.call(i & 4 ? [] : i).length;
say(sum);

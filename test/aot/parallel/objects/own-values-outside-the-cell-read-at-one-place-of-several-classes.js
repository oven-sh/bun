// One read by name meets objects of several Structures that keep the value outside the cell.
function messageOf(value) {
  return value.message;
}

class Custom extends Error {}
const withGetter = new RangeError("hidden");
Object.defineProperty(withGetter, "message", { get() { return "from a getter"; }, configurable: true });
const withoutMessage = new SyntaxError();
const deleted = new TypeError("deleted");
delete deleted.message;
const replaced = new EvalError("first");
replaced.message = 42;
const withCause = new Error("with a cause", { cause: 1 });
const frozen = Object.freeze(new URIError("frozen"));
const wide = {};
for (let i = 0; i < 12; i++) wide["name" + i] = i;
wide.message = "in a wide object";
const list = Object.assign([1, 2], { message: "on a list" });
const onFunction = Object.assign(function () {}, { message: "on a function" });

const values = [
  new Error("plain"), new TypeError("type"), new RangeError("range"), new SyntaxError("syntax"), new Custom("custom"),
  withGetter, withoutMessage, deleted, replaced, withCause, frozen, wide, list, onFunction,
  new AggregateError([], "aggregate"), { message: "in the cell" }, Object.create({ message: "inherited" }), "text", 5,
];

let lengths = 0;
for (let round = 0; round < 3000; round++) {
  for (const value of values) lengths += String(messageOf(value)).length;
}
console.log(lengths);
for (const value of values) console.log(typeof value, JSON.stringify(messageOf(value)));

withoutMessage.message = "stored later";
Object.defineProperty(values[1], "message", { value: "redefined", writable: false });
delete values[2].message;
RangeError.prototype.message = "of the prototype";
for (const value of values) console.log(JSON.stringify(messageOf(value)));

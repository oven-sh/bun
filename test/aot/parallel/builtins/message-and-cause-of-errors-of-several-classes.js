// `error.message` and `error.cause` are read in one place from errors of several built-in classes: the constructor of each leaves them at the same place in the object.
// Some of the errors no longer have them there: they were made without, stored to, deleted, turned into accessors, given more properties, or belong to a class of the program.
// Each case reads its own list in its own function, so that what is known of the errors at one read is what that case holds.
function show(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function errorAndTypeError() {
  const list = [new Error("a"), new TypeError("bb"), new Error("ccc"), new TypeError("dddd")];
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += list[i & 3].message.length;
  return text + sum;
}
console.log("Error and TypeError:", errorAndTypeError());

function neitherIsError() {
  const list = [new TypeError("t"), new RangeError("rr"), new TypeError("ttt"), new RangeError("rrrr")];
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += list[i & 3].message.length;
  return text + sum;
}
console.log("TypeError and RangeError:", neitherIsError());

function oneClassBelowError() {
  const list = [new RangeError("one"), new RangeError("three", { cause: 3 }), new RangeError()];
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += list[i % 3].message.length;
  return text + sum;
}
console.log("RangeError alone:", oneClassBelowError());

function everyClass() {
  const list = [new Error("error"), new EvalError("eval"), new RangeError("range"), new ReferenceError("reference"), new SyntaxError("syntax"), new TypeError("type"), new URIError("uri")];
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += list[i % 7].message.length;
  return text + sum;
}
console.log("every class:", everyClass());

function besideErrorsThatHoldMore() {
  const list = [new Error("e"), new AggregateError([1], "aggregate"), new SuppressedError(1, 2, "suppressed"), new TypeError("t"), new AggregateError([], "caused", { cause: 4 })];
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  return text;
}
console.log("beside errors that hold more:", besideErrorsThatHoldMore());

function withCauses() {
  const list = [
    new Error("e", { cause: 1 }),
    new TypeError("t", { cause: "why" }),
    new RangeError("r", { cause: undefined }),
    new SyntaxError(undefined, { cause: "alone" }),
    new URIError("u"),
    new EvalError("v", {}),
  ];
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + " " + Object.hasOwn(error, "cause") + ", ";
  return text;
}
console.log("causes:", withCauses());

function calledWithoutNew() {
  const list = [Error("called"), TypeError("called too"), RangeError(5), SyntaxError(null)];
  let text = "";
  for (const error of list) text += show(error.message) + ", ";
  return text;
}
console.log("called without new:", calledWithoutNew());

function madeWithoutMessage() {
  const list = [new Error(), new TypeError(), new RangeError(undefined), new Error("with")];
  let text = "";
  for (const error of list) text += show(error.message) + " " + Object.hasOwn(error, "message") + ", ";
  return text;
}
console.log("made without a message:", madeWithoutMessage());

function storedTo() {
  const list = [new Error("first"), new TypeError("second"), new RangeError("third"), new TypeError("fourth")];
  list[0].message = 5;
  list[1].message = undefined;
  list[2].message = { toString: () => "object" };
  list[3].cause = "stored";
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  return text;
}
console.log("stored to:", storedTo());

function deleted() {
  const list = [new Error("gone"), new TypeError("gone too"), new RangeError("stays"), new TypeError("keeps", { cause: "gone" })];
  delete list[0].message;
  delete list[1].message;
  delete list[3].cause;
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  return text;
}
console.log("deleted:", deleted());

function accessors() {
  const list = [new Error("hidden"), new TypeError("hidden too"), new RangeError("plain")];
  let reads = 0;
  Object.defineProperty(list[0], "message", { get: () => "getter " + ++reads, configurable: true });
  Object.defineProperty(list[1], "message", { get: () => "getter " + ++reads, configurable: true });
  let text = "";
  for (let turn = 0; turn < 2; turn++) for (const error of list) text += show(error.message) + ", ";
  return text + reads;
}
console.log("accessors:", accessors());

function withMoreProperties() {
  const list = [new Error("coded"), new TypeError("coded too"), new RangeError("has a stack")];
  list[0].code = "E_ONE";
  list[1].code = "E_TWO";
  list[2].stack;
  let text = "";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  list[0].cause = "added later";
  for (const error of list) text += show(error.message) + " " + show(error.cause) + ", ";
  return text;
}
console.log("with more properties:", withMoreProperties());

function frozen() {
  const list = [Object.freeze(new Error("frozen")), Object.seal(new TypeError("sealed")), Object.preventExtensions(new RangeError("closed"))];
  let text = "";
  for (const error of list) text += show(error.message) + ", ";
  return text;
}
console.log("frozen:", frozen());

class Derived extends TypeError {}
class WithField extends RangeError {
  code = 7;
}
class Overrides extends Error {
  get message() {
    return "from the class";
  }
}
function classesOfTheProgram() {
  const list = [new Derived("derived"), new WithField("field"), new Overrides("own wins"), new Overrides(), new Error("plain"), new TypeError("plain too")];
  let text = "";
  for (const error of list) text += show(error.message) + ", ";
  return text;
}
console.log("classes of the program:", classesOfTheProgram());

function anotherPrototype() {
  const list = [new Error("kept"), new TypeError("kept too"), new TypeError(), new RangeError()];
  Object.setPrototypeOf(list[1], { message: "not seen" });
  Object.setPrototypeOf(list[2], { message: "from the new prototype" });
  Object.setPrototypeOf(list[3], null);
  let text = "";
  for (const error of list) text += show(error.message) + ", ";
  return text;
}
console.log("another prototype:", anotherPrototype());

function thrownBy(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
}
function thrownByTheEngine() {
  const list = [thrownBy(() => null.x), thrownBy(() => new Array(-1)), thrownBy(() => missing), thrownBy(() => decodeURIComponent("%")), thrownBy(() => JSON.parse("{"))];
  let text = "";
  for (const error of list) text += error.constructor.name + " " + typeof error.message + " " + (error.message.length > 0) + " " + show(error.cause) + ", ";
  return text;
}
console.log("thrown by the engine:", thrownByTheEngine());

function behindInstanceOf(values) {
  let text = "";
  for (const value of values) text += (value instanceof Error ? show(value.message) : "no error") + ", ";
  return text;
}
console.log("behind instanceof:", behindInstanceOf([new Error("x"), "text", new TypeError("y"), 5, null, new RangeError(), { message: "an object" }]));

// The prototypes change last: every list above was read while they were as the realm made them.
const inherits = [new Error(), new TypeError(), new RangeError(), new TypeError("own"), new EvalError(), new RangeError("caused", { cause: 0 })];
function readInherits() {
  let text = "";
  for (const error of inherits) text += show(error.message) + " " + show(error.cause) + ", ";
  return text;
}
console.log("before the prototypes change:", readInherits());
TypeError.prototype.message = "of TypeError.prototype";
console.log("TypeError.prototype.message stored:", readInherits());
Error.prototype.message = "of Error.prototype";
console.log("Error.prototype.message stored:", readInherits());
delete RangeError.prototype.message;
console.log("RangeError.prototype.message deleted:", readInherits());
EvalError.prototype.message = 42;
console.log("EvalError.prototype.message is a number:", readInherits(), typeof inherits[4].message, inherits[4].message + 1);
Error.prototype.cause = "inherited cause";
console.log("Error.prototype.cause stored:", readInherits());
Object.defineProperty(TypeError.prototype, "cause", { get: () => "cause from a getter", configurable: true });
console.log("TypeError.prototype.cause is a getter:", readInherits());
console.log("read again:", errorAndTypeError(), neitherIsError(), oneClassBelowError(), madeWithoutMessage(), withCauses());

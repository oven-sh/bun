// What the constructor and the engine put on a new error: message, stack, line, column, sourceURL, cause. Each is used as what it is: a text is measured and cut, a number is added to.
const say = (...values) => console.log(...values);
const kindOf = value => (value === null ? "null" : typeof value);

const plain = new Error("first");
say(plain.message.length, plain.message.toUpperCase(), plain.stack.split("\n")[0], kindOf(plain.line), kindOf(plain.column), kindOf(plain.sourceURL));
say(plain.line + 0 === plain.line, plain.column > 0, plain.sourceURL.length > 0, plain.cause, "cause" in plain, Object.hasOwn(plain, "message"));
say(Object.getOwnPropertyNames(plain).sort().join());

// Without a message the prototype answers, and whatever is passed is converted to a string.
const silent = new Error();
say(JSON.stringify(silent.message), Object.hasOwn(silent, "message"), silent.message.length, String(silent));
say(new Error(5).message + 1, new Error(null).message.length, new Error({ toString: () => "converted" }).message.slice(0, 4), new Error(undefined).message === "");
try {
  new Error(Symbol("no text"));
} catch (error) {
  say(error instanceof TypeError, error.message.length > 0);
}

// Called without `new`, and each kind of the language.
const called = Error("called");
say(called instanceof Error, called.message.length, called.stack.includes("called"), Object.getPrototypeOf(called) === Error.prototype);
for (const Kind of [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError]) {
  const made = new Kind("of a kind");
  say(made.name, made.message.length, made instanceof Kind, made instanceof Error, String(made), made.stack.startsWith(made.name), Kind("x").message);
}

// The cause is whatever the options hold, and is there only if they have the property.
class Reason { describe() { return "the reason ran"; } }
say(new Error("a", { cause: new Reason() }).cause.describe(), new Error("a", { cause: undefined }).cause, "cause" in new Error("a", { cause: undefined }), "cause" in new Error("a", {}));
say(new Error("a", { get cause() { return "from a getter"; } }).cause, new Error("a", 5).cause, new Error("a", null).cause);

const many = new AggregateError([new Reason(), 2], "several", { cause: 7 });
say(many.errors.length, many.errors[0].describe(), many.errors[1] + 1, many.message.length, many.cause + 1, many.name);
const suppressed = new SuppressedError(new Reason(), "hidden", "both");
say(suppressed.error.describe(), suppressed.suppressed.length, suppressed.message.length, suppressed.name);

// A program stores, deletes and redefines what it likes.
plain.message = 12;
say(plain.message + 1, String(plain));
plain.stack = { replaced: true };
say(plain.stack.replaced, delete plain.stack, plain.stack, delete plain.message, JSON.stringify(plain.message));
const redefined = new Error("redefined");
Object.defineProperty(redefined, "message", { get() { return ["from", "a", "getter"]; } });
Object.defineProperty(redefined, "stack", { value: 3, writable: true });
say(redefined.message.length, redefined.stack + 1);
redefined.line = "a text now";
say(redefined.line.length);

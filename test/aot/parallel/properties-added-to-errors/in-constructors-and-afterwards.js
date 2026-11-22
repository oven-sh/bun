const say = (...values) => console.log(...values.map(value => (typeof value === "string" ? value : JSON.stringify(value))));
const listed = error => Object.getOwnPropertyNames(error).filter(name => !["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"].includes(name));
const firstLine = error => String(error.stack).split("\n")[0];

class HttpError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.expose = status < 500;
  }
}
class NotFound extends HttpError {
  constructor(path) {
    super(404, `no ${path}`);
    this.path = path;
  }
}
class WithField extends Error {
  code = "FIELD";
  detail;
  constructor(message) {
    super(message);
    this.detail = { message };
  }
}
class WithSetter extends Error {
  constructor(value) {
    super("with a setter");
    this.value = value;
    this.after = 1;
  }
  set value(value) {
    this.seen = [value];
  }
  get value() {
    return this.seen?.[0];
  }
}
class WithReadOnly extends Error {
  constructor() {
    super("read only");
    try {
      this.fixed = 1;
      this.wasStored = true;
    } catch (error) {
      this.wasStored = error.constructor.name;
    }
  }
}
Object.defineProperty(WithReadOnly.prototype, "fixed", { value: 0, writable: false });

function withCode(message, code) {
  const error = new Error(message);
  error.code = code;
  error.errno = -2;
  error.syscall = "open";
  return error;
}
function sloppyAdd(error, value) {
  return Function.prototype.call.call(function () {
    error.added = value;
    return error.added;
  });
}

for (let i = 0; i < 40; i++) {
  const errors = [new HttpError(400 + i * 5, "bad " + i), new NotFound("/" + i), new WithField("f" + i), new WithSetter(i), new WithReadOnly(), withCode("m" + i, "E" + i)];
  if (i % 13 === 0)
    for (const error of errors)
      say(error.constructor.name, error.name, error.message, listed(error), Object.keys(error), Object.keys(error).map(key => error[key]), firstLine(error), String(error));
}

// The lazy properties, before and after they are made.
for (let i = 0; i < 40; i++) {
  const error = withCode("lazy", i);
  const first = i % 4;
  if (first === 1) firstLine(error);
  if (first === 2) error.stack = "my stack " + i;
  if (first === 3) error.line = i;
  error.behind = first;
  error.column = 7;
  error.sourceURL = "here";
  if (i > 35) say(first, Object.keys(error), error.behind, error.column, error.sourceURL, first === 2 ? error.stack : firstLine(error), first === 3 ? error.line : typeof error.line);
}

// Errors that take no more properties.
for (let i = 0; i < 40; i++) {
  const error = new Error("closed");
  const how = i % 4;
  if (how === 1) Object.preventExtensions(error);
  if (how === 2) Object.seal(error);
  if (how === 3) Object.freeze(error);
  let result = "stored";
  try {
    (function () {
      "use strict";
      error.extra = i;
    })();
  } catch (thrown) {
    result = thrown.constructor.name;
  }
  if (i > 35) say(how, result, "extra" in error, listed(error));
}

// Names that mean something elsewhere, indexes and symbols.
const symbol = Symbol("mark");
const names = ["message", "name", "cause", "toString", "constructor", "length", "then", "toJSON", "0", "1", "-1", "01", "code", "__proto__", "errors", "valueOf", symbol];
for (const name of names)
  for (let i = 0; i < 12; i++) {
    const error = i % 2 ? new Error() : new TypeError("t");
    error[name] = i;
    if (i > 9) say(String(name), Object.keys(error), Object.getOwnPropertySymbols(error).length, String(error[name]), Object.getPrototypeOf(error) === (i % 2 ? Error : TypeError).prototype);
  }

// All kinds of errors at one site.
const kinds = [Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError, message => new AggregateError([1], message), message => new DOMException(message, "AbortError"), HttpError, message => Object.assign(new Error(message), { a: 1 }), message => ({ message }), message => [message], message => structuredClone(new Error(message))];
function make(kind, message) {
  return kind.prototype ? new kind(message) : kind(message);
}
for (let round = 0; round < 4; round++)
  kinds.forEach((kind, index) => {
    const error = make(kind, "k" + index);
    error.kind = index;
    error.round = round;
    if (round === 3) say(index, Object.keys(error), error.kind, error.round, error instanceof Error, String(error.message));
  });

// A setter that appears on the prototype later.
class Late extends Error {
  constructor(value) {
    super("late");
    this.late = value;
  }
}
for (let i = 0; i < 30; i++) {
  if (i === 20)
    Object.defineProperty(Late.prototype, "late", {
      configurable: true,
      set(value) {
        this.heard = value;
      },
      get() {
        return "by the getter";
      },
    });
  if (i === 25) Object.defineProperty(Late.prototype, "late", { value: 1, writable: false });
  let error;
  try {
    error = new Late(i);
  } catch (thrown) {
    error = thrown;
  }
  if (i % 5 === 4) say(i, error.constructor.name, Object.keys(error), String(error.late), String(error.heard));
}

// The prototype is replaced, and properties are removed and added again.
for (let i = 0; i < 20; i++) {
  const error = withCode("moved", i);
  if (i % 2) Object.setPrototypeOf(error, HttpError.prototype);
  error.more = 1;
  delete error.code;
  error.code = "again";
  error.last = i;
  if (i > 17) say(Object.keys(error), error instanceof HttpError, error.code, sloppyAdd(error, i), firstLine(error));
}

// Errors thrown and caught, with properties added on the way.
function thrower(depth) {
  if (depth === 0) throw withCode("deep", "EDEEP");
  try {
    return thrower(depth - 1);
  } catch (error) {
    error.depth = (error.depth ?? 0) + 1;
    error["level" + depth] = depth;
    throw error;
  }
}
for (let i = 0; i < 10; i++)
  try {
    thrower(6);
  } catch (error) {
    if (i === 9) say(Object.keys(error), error.depth, error.level6, firstLine(error));
  }
say(JSON.parse(JSON.stringify(new NotFound("/x"))), Object.entries({ ...new HttpError(500, "spread") }));

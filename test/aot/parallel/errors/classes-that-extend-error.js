// Classes of the program that extend Error and its kinds: their own fields, methods, getters and statics, what they inherit, and what the engine puts on their instances.
const say = (...values) => console.log(...values);

class Empty extends Error {}
const empty = new Empty("nothing of its own");
say(empty.message.length, empty.name, empty instanceof Empty, empty instanceof Error, empty.constructor === Empty, empty.stack.split("\n")[0], String(empty));
say(Object.getPrototypeOf(empty) === Empty.prototype, Object.getPrototypeOf(Empty) === Error, Object.getOwnPropertyNames(empty).sort().join());

class HttpError extends Error {
  static count = 0;
  #secret = "kept";
  status;
  constructor(status, message, options) {
    super(message, options);
    this.status = status;
    this.name = "HttpError";
    HttpError.count++;
  }
  get isServerError() { return this.status >= 500; }
  describe() { return `${this.name} ${this.status}: ${this.message} (${this.#secret})`; }
  toJSON() { return { status: this.status, message: this.message }; }
}
const failed = new HttpError(503, "unavailable", { cause: empty });
say(failed.describe(), failed.isServerError, failed.status + 1, failed.cause === empty, failed.cause.message.length, HttpError.count, JSON.stringify(failed));
say(String(failed), failed.stack.startsWith("HttpError: unavailable") || failed.stack.startsWith("Error: unavailable"), failed.line > 0);

class NotFound extends HttpError {
  constructor(path) { super(404, `no ${path}`); this.path = path; }
  describe() { return `${super.describe()} at ${this.path}`; }
}
const missing = new NotFound("/x");
say(missing.describe(), missing instanceof NotFound, missing instanceof HttpError, missing instanceof Error, missing.isServerError, HttpError.count);

class Typed extends TypeError {
  get message() { return "the getter of the class is hidden by the own property"; }
}
say(new Typed("own").message, new Typed().message, new Typed("own") instanceof TypeError, new Typed("x").name);

// Thrown, caught, thrown on, and told apart.
function fail(kind) {
  if (kind === 0) throw new NotFound("/thrown");
  if (kind === 1) throw new HttpError(500, "thrown");
  if (kind === 2) throw new RangeError("of the language");
  throw new Empty("last");
}
for (let kind = 0; kind < 4; kind++) {
  try {
    fail(kind);
  } catch (error) {
    if (error instanceof NotFound) say("NotFound", error.path.length, error.describe());
    else if (error instanceof HttpError) say("HttpError", error.status, error.describe());
    else if (error instanceof RangeError) say("RangeError", error.message.length);
    else say("other", error.constructor.name, error.message.toUpperCase());
  }
}

// new.target decides the prototype, and a function that is no class extends Error too.
const reflected = Reflect.construct(Error, ["reflected"], NotFound);
say(reflected instanceof NotFound, reflected.message.length, reflected.path, reflected.status);
function Old(message) {
  const self = Reflect.construct(Error, [message], new.target ?? Old);
  self.old = true;
  return self;
}
Object.setPrototypeOf(Old.prototype, Error.prototype);
Object.setPrototypeOf(Old, Error);
say(new Old("in the old way").message.length, new Old("x") instanceof Old, new Old("x").old, Old("called") instanceof Old);

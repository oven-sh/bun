// A class below a built-in class declares fields under names that the constructor above lays on the new object itself.
function describe(object, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  if (!descriptor) return name + ": none";
  return (
    name +
    ": " +
    ("value" in descriptor ? typeof descriptor.value : "accessor") +
    (descriptor.enumerable ? " enumerable" : "") +
    (descriptor.writable ? " writable" : "")
  );
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}

class Failure extends Error {
  constructor(text, fill) {
    super(text, { cause: "given" });
    if (fill) {
      this.message = 1;
      this.cause = 2;
      this.stack = 3;
    }
  }
}
for (const fill of [false, true]) {
  const failure = new Failure("text", fill);
  console.log(typeof failure.message, typeof failure.cause, typeof failure.stack, Object.keys(failure).join());
  console.log(describe(failure, "message"), describe(failure, "cause"), describe(failure, "stack"));
}

class Row extends Array {
  constructor(fill) {
    super(3);
    if (fill) this.length = 1;
    this.tag = "row";
  }
}
console.log(
  new Row(false).length,
  new Row(true).length,
  describe(new Row(false), "length"),
  Object.keys(new Row(true)).join(),
);

class Pattern extends RegExp {
  constructor(fill) {
    super("a", "g");
    if (fill) this.lastIndex = 5;
  }
}
const pattern = new Pattern(false);
pattern.exec("aaa");
console.log(pattern.lastIndex, new Pattern(true).lastIndex, describe(pattern, "lastIndex"));

class Signal extends Event {
  constructor(fill) {
    super("signal");
    this.a = 1;
    if (fill) this.outcome = attempt(() => ((this.isTrusted = 7), "stored"));
  }
}
console.log(
  new Signal(false).isTrusted,
  new Signal(true).isTrusted,
  new Signal(true).outcome,
  describe(new Signal(false), "isTrusted"),
);

class Named extends Function {
  constructor(fill) {
    super("return 1");
    if (fill) this.outcome = attempt(() => ((this.name = "other"), (this.length = 9), "stored"));
  }
}
console.log(
  new Named(false).name,
  new Named(true).name,
  new Named(true).length,
  new Named(true).outcome,
  describe(new Named(false), "name"),
);

class Text extends String {
  constructor(fill) {
    super("abc");
    if (fill) this.outcome = attempt(() => ((this.length = 9), (this[0] = "z"), "stored"));
  }
}
console.log(
  new Text(false).length,
  new Text(true).length,
  new Text(true)[0],
  new Text(true).outcome,
  Object.keys(new Text(true)).join(),
);

class Bytes extends Uint8Array {
  constructor(fill) {
    super(2);
    this.tag = "bytes";
    if (fill) this.outcome = attempt(() => ((this.length = 9), (this.byteLength = 9), "stored"));
  }
}
console.log(
  new Bytes(false).length,
  new Bytes(true).length,
  new Bytes(true).outcome,
  Object.keys(new Bytes(true)).join(),
);

class Stopper extends AbortController {
  constructor(fill) {
    super();
    if (fill) this.outcome = attempt(() => ((this.signal = 1), "stored"));
  }
}
console.log(
  typeof new Stopper(false).signal,
  typeof new Stopper(true).signal,
  new Stopper(true).outcome,
  describe(new Stopper(true), "signal"),
);

class Reply extends Response {
  constructor(fill) {
    super("body", { status: 201 });
    if (fill) this.outcome = attempt(() => ((this.status = 1), (this.ok = 2), "stored"));
  }
}
console.log(
  new Reply(false).status,
  new Reply(true).status,
  new Reply(true).ok,
  new Reply(true).outcome,
  Object.keys(new Reply(true)).join(),
);

// Fields that hold closures are deleted, redefined, frozen and sealed: before the store of the closure, between two stores and afterwards.
"use strict";
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}
function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}

class Plain {
  n = 1;
  run = () => this.n;
  stop = () => -this.n;
  last = "last";
  again() {
    this.run = () => this.n + 10;
    return this;
  }
}

// Deleted afterwards, unread and read.
for (const readsFirst of [false, true]) {
  const object = new Plain();
  const before = readsFirst ? object.run : null;
  say("delete", delete object.run, object.run, "run" in object, Object.keys(object).join(), before ? before() : "-");
  object.again();
  say("stored again", object.run(), Object.keys(object).join(), object.run === object.run, object.run !== before);
  delete object.run;
  object.run = 5;
  say("another value", object.run, Object.keys(object).join());
  object.again();
  say("a closure over the other value", object.run(), Object.keys(object).join());
}

// Deleted by a field initializer that runs between two definitions.
class DeletesInBetween {
  run = () => "run";
  removed = delete this.run;
  keysThen = Object.keys(this).join();
  stop = () => "stop";
}
const deleted = new DeletesInBetween();
say("deleted in between", deleted.removed, deleted.keysThen, deleted.run, deleted.stop(), Object.keys(deleted).join());

// Redefined: not enumerable, read-only, an accessor.
function redefined(descriptor) {
  const object = new Plain();
  Object.defineProperty(object, "run", descriptor);
  return object;
}
const hidden = redefined({ enumerable: false });
say("hidden", hidden.run(), Object.keys(hidden).join(), hidden.run === hidden.run, JSON.stringify(Object.getOwnPropertyDescriptor(hidden, "run")));
const readOnly = redefined({ writable: false });
say("read-only", readOnly.run(), attempt(() => readOnly.again().run()), readOnly.run(), Object.keys(readOnly).join());
const accessor = redefined({ get: () => () => "from the getter" });
say("accessor", accessor.run(), attempt(() => accessor.again().run()), Object.keys(accessor).join());
const replaced = redefined({ value: () => "replaced" });
say("replaced", replaced.run(), replaced.again().run(), Object.keys(replaced).join());
const number = redefined({ value: 3 });
say("a number", number.run, number.again().run(), Object.keys(number).join());

// Redefined before the definition of the field.
class RedefinedEarly {
  early = Object.defineProperty(this, "run", { value: "early", configurable: true, enumerable: false, writable: false }) && "done";
  run = () => "defined";
}
const redefinedEarly = new RedefinedEarly();
say("redefined early", redefinedEarly.run(), Object.keys(redefinedEarly).join(), JSON.stringify(Object.getOwnPropertyDescriptor(redefinedEarly, "run")));
class FixedEarly {
  early = Object.defineProperty(this, "run", { value: "early", configurable: false }) && "done";
  run = () => "defined";
}
say("fixed early", attempt(() => new FixedEarly().run));

// Frozen, sealed and closed afterwards.
for (const [name, close] of [["freeze", Object.freeze], ["seal", Object.seal], ["preventExtensions", Object.preventExtensions]]) {
  for (const readsFirst of [false, true]) {
    const object = new Plain();
    const before = readsFirst ? object.run : null;
    close(object);
    say(name, object.run(), before === null || before === object.run, attempt(() => object.again().run()), attempt(() => delete object.run), object.run === undefined ? "gone" : object.run(), Object.isFrozen(object), Object.keys(object).join());
    say(name + " then stored", attempt(() => object.again().run()), Object.keys(object).join());
  }
}

// Frozen, sealed and closed between the definitions.
for (const [name, close] of [["freeze", Object.freeze], ["seal", Object.seal], ["preventExtensions", Object.preventExtensions]]) {
  class ClosedInBetween {
    run = () => "run";
    closed = close(this) && "closed";
    stop = () => "stop";
  }
  say(name + " in between", attempt(() => Object.keys(new ClosedInBetween()).join()));
}
let escaped;
class ClosedHalfway {
  run = () => "run";
  self = (escaped = this);
  closed = Object.preventExtensions(this);
  stop = () => "stop";
}
say("halfway", attempt(() => new ClosedHalfway()), Object.keys(escaped).join(), escaped.run(), escaped.stop, escaped.run === escaped.run);

// A store (not a definition) into a closed object.
class StoresWhenClosed {
  constructor(close) {
    this.first = () => "first";
    if (close) Object.preventExtensions(this);
    this.second = () => "second";
  }
}
say("store when closed", attempt(() => Object.keys(new StoresWhenClosed(false)).join()), attempt(() => Object.keys(new StoresWhenClosed(true)).join()));

// Many objects, some of them changed, read afterwards.
const objects = [];
for (let i = 0; i < 24; i++) {
  const object = new Plain();
  object.n = i;
  if (i % 6 === 1) delete object.stop;
  if (i % 6 === 2) Object.freeze(object);
  if (i % 6 === 3) Object.defineProperty(object, "stop", { value: () => "s" + i, enumerable: false });
  if (i % 6 === 4) object.stop = object.run;
  if (i % 6 === 5) object.extra = () => i;
  objects.push(object);
}
say("many", objects.map(object => attempt(() => object.stop())).join());
say("many keys", objects.slice(0, 6).map(object => Object.keys(object).join("+")).join());
say("many again", objects.map(object => attempt(() => object.again().run())).join());

console.log(lines.join("\n"));

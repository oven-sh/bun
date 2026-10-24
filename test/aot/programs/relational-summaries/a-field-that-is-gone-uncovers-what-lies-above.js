// An own field hides what the prototypes hold under its name. Where the field is deleted, was never filled, or is left out by one of two constructions, a callee's read finds a getter above and its store a setter, each with the caller's object as `this`.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag).join("+") || "nobody";
const readSize = thing => thing.size;
const writeSize = (thing, size) => {
  thing.size = size;
};
class Above {
  get size() {
    kept.push(this);
    return "from above";
  }
  set size(value) {
    kept.push(this);
    Object.defineProperty(this, "size", { value: "set " + value, writable: true, configurable: true, enumerable: true });
  }
}
class Hides extends Above {
  size = 1;
  constructor(tag) {
    super();
    this.tag = tag;
  }
}
const lines = [];
function step(what, run) {
  lines.push(what + " " + run());
  churn(20);
  lines.push(report());
}
step("hidden", () => readSize(new Hides("hidden")));
step("deleted", () => {
  const thing = new Hides("deleted");
  delete thing.size;
  return readSize(thing);
});
step("deleted by key", () => {
  const thing = new Hides("deleted by key");
  Reflect.deleteProperty(thing, ["si", "ze"].join(""));
  return readSize(thing);
});
step("deleted, then stored", () => {
  const thing = new Hides("deleted, then stored");
  delete thing.size;
  writeSize(thing, 5);
  return readSize(thing);
});
step("stored over the field", () => {
  const thing = new Hides("stored over the field");
  writeSize(thing, 6);
  return readSize(thing);
});
// A literal that leaves the name out, below an object with the accessor.
const shared = {
  get size() {
    kept.push(this);
    return "from the shared object";
  },
  set size(value) {
    kept.push(this);
  },
};
function make(tag, withSize) {
  const thing = withSize ? { __proto__: shared, tag, size: 2 } : { __proto__: shared, tag };
  return thing;
}
step("literal with", () => readSize(make("literal with", true)));
step("literal without", () => readSize(make("literal without", false)));
step("literal without, stored", () => {
  const thing = make("literal without, stored", false);
  writeSize(thing, 3);
  return readSize(thing);
});
step("created", () => readSize(Object.assign(Object.create(shared), { tag: "created" })));
// The callee deletes and reads in one go.
function dropAndRead(thing) {
  delete thing.size;
  return thing.size;
}
step("dropped by the callee", () => dropAndRead(new Hides("dropped by the callee")));
step("dropped by the callee, literal", () => dropAndRead(make("dropped by the callee, literal", true)));
console.log(lines.join("\n"));

// One helper, `attempt`, is handed more callbacks than the summary of a body follows at one call. What the helper does is then whatever any of them does: `last`, a variable of
// countInALoop that only its own callback stores to, has its new value behind the call.
function fresh() {
  return {
    count: 1,
    label: "part",
    inner: { depth: 2 },
    action: () => 3,
    note: "note",
    id: 4,
    total() {
      return this.count + this.inner.depth + this.action() + this.id;
    },
    title() {
      return this.label + ":" + (this.note ?? "none");
    }
  };
}
function other() {
  return {
    title() {
      return this.label + ":" + (this.note ?? "none");
    },
    total() {
      return this.count + this.inner.depth + this.action() + this.id + 5;
    },
    id: 4,
    note: "note",
    action: () => 3,
    inner: { depth: 2 },
    label: "part",
    count: 1
  };
}
let quiet = false;
function text(value) {
  if (typeof value === "number")
    return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string")
    return "string " + JSON.stringify(value);
  if (typeof value === "bigint")
    return "bigint " + String(value);
  if (typeof value === "symbol")
    return "symbol";
  if (typeof value === "function")
    return "function";
  if (typeof value === "object" && value !== null)
    return "object " + JSON.stringify(value);
  return String(value);
}
function nameOf(error) {
  if (error instanceof TypeError)
    return "TypeError";
  if (error instanceof RangeError)
    return "RangeError";
  if (error instanceof ReferenceError)
    return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}
function attempt(label, body) {
  let line;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet)
    console.log(label + ": " + line);
}

class Holder {
  part;
  constructor(part) {
    this.part = part;
  }
}
function plusOne(p) {
  return p.count + 1;
}
function useCount(label, p) {
  attempt(label + ", read", () => p.count);
  attempt(label + ", typeof", () => typeof p.count);
  attempt(label + ", plus one", () => p.count + 1);
  attempt(label + ", doubled", () => p.count * 2);
  attempt(label + ", as an integer", () => p.count | 0);
  attempt(label + ", compared", () => p.count > 0);
  attempt(label + ", is undefined", () => p.count === undefined);
  attempt(label + ", is null or undefined", () => p.count == null);
  attempt(label + ", is a number", () => typeof p.count === "number");
  attempt(label + ", a callback asks", () => [p].filter((q) => typeof q.count === "number").length);
  attempt(label + ", a method of the number", () => p.count.toFixed(1));
  attempt(label + ", a typed function", () => plusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", incremented", () => ++p.count);
  attempt(label + ", stored", () => p.count = 10);
  attempt(label + ", read after the store", () => p.count);
}
function briefCount(label, p) {
  attempt(label + ", used", () => p.count + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}
function countInPlaces(label, make) {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.count + 1);
  const list = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].count + 1);
  attempt(label + ", a result", () => make().count + 1);
}
function countInALoop(label, write) {
  const p = fresh();
  let honest = 0;
  let last = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0;i < 2000; i++) {
      if (i === 1000)
        write(p);
      const value = p.count + 1;
      if (typeof value === "number")
        honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet)
    console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}
function lengthOf(p) {
  return p.label.length;
}
function useLabel(label, p) {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter((q) => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => p.label += "?");
  attempt(label + ", stored", () => p.label = "stored");
  attempt(label + ", read after the store", () => p.label);
}
function briefLabel(label, p) {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}
function depthOf(p) {
  return p.inner.depth;
}
function useInner(label, p) {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter((q) => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => ("depth" in p.inner));
  attempt(label + ", a pattern", () => (({ depth }) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => p.inner.depth = 9);
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}
function briefInner(label, p) {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}
function run(p) {
  return p.action();
}
function useAction(label, p) {
  attempt(label + ", typeof", () => typeof p.action);
  attempt(label + ", is undefined", () => p.action === undefined);
  attempt(label + ", is a function", () => typeof p.action === "function");
  attempt(label + ", a callback asks", () => [p].filter((q) => typeof q.action === "function").length);
  attempt(label + ", called", () => p.action());
  attempt(label + ", its result plus one", () => p.action() + 1);
  attempt(label + ", taken off and called", () => ((f) => f())(p.action));
  attempt(label + ", through call", () => p.action.call(undefined));
  attempt(label + ", its length", () => p.action.length);
  attempt(label + ", a typed function", () => run(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", replaced and called", () => (p.action = () => 30)());
  attempt(label + ", called after that", () => p.action());
}
function briefAction(label, p) {
  attempt(label + ", used", () => p.action());
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}
function noteOf(p) {
  return p.note ?? "none";
}
function useNote(label, p) {
  attempt(label + ", read", () => p.note);
  attempt(label + ", typeof", () => typeof p.note);
  attempt(label + ", is undefined", () => p.note === undefined);
  attempt(label + ", is a string", () => typeof p.note === "string");
  attempt(label + ", or a default", () => p.note ?? "none");
  attempt(label + ", its length", () => p.note?.length);
  attempt(label + ", in", () => ("note" in p));
  attempt(label + ", a typed function", () => noteOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", stored", () => p.note = "stored");
  attempt(label + ", read after the store", () => p.note);
  attempt(label + ", deleted", () => delete p.note);
  attempt(label + ", read after the delete", () => p.note);
}
function briefNote(label, p) {
  attempt(label + ", used", () => p.note ?? "none");
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}
function idPlusOne(p) {
  return p.id + 1;
}
function useId(label, p) {
  attempt(label + ", read", () => p.id);
  attempt(label + ", typeof", () => typeof p.id);
  attempt(label + ", is undefined", () => p.id === undefined);
  attempt(label + ", is a number", () => typeof p.id === "number");
  attempt(label + ", plus one", () => p.id + 1);
  attempt(label + ", as an integer", () => p.id | 0);
  attempt(label + ", a typed function", () => idPlusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
}
function briefId(label, p) {
  attempt(label + ", used", () => p.id + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}
const countWrites = [
  ["count becomes a string", (p) => {
    Object.defineProperties(p, { count: { value: "text" } });
  }]
];
quiet = true;
for (let i = 0;i < 3; i++) {
  useCount("", fresh());
  briefCount("", other());
  useLabel("", fresh());
  briefLabel("", other());
  useInner("", fresh());
  briefInner("", other());
  useAction("", fresh());
  briefAction("", other());
  useNote("", fresh());
  briefNote("", other());
  useId("", fresh());
  briefId("", other());
}
quiet = false;
for (const [label, write] of countWrites) {
  const first = fresh();
  write(first);
  useCount(label + ", a literal", first);
  const second = other();
  write(second);
  briefCount(label + ", a literal written backwards", second);
  countInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  countInALoop(label, write);
}

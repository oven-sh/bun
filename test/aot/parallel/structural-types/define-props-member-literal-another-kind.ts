// Flags: --aot-validate
// Define properties gives each member of a literal another kind of value.
interface Inner {
  depth: number;
}

interface Part {
  count: number;
  label: string;
  inner: Inner;
  action: () => number;
  note?: string;
  readonly id: number;
  total(): number;
  title(): string;
}

function fresh(): Part {
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
    },
  };
}

function other(): Part {
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
    count: 1,
  };
}

let quiet = false;

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return String(value);
}

function nameOf(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  return error instanceof Error ? "another error" : typeof error;
}

function attempt(label: string, body: () => unknown): void {
  let line: string;
  try {
    line = text(body());
  } catch (error) {
    line = "threw " + nameOf(error);
  }
  if (!quiet) console.log(label + ": " + line);
}

class Holder {
  part: Part;
  constructor(part: Part) {
    this.part = part;
  }
}

function plusOne(p: Part): number {
  return p.count + 1;
}

function useCount(label: string, p: Part): void {
  attempt(label + ", read", () => p.count);
  attempt(label + ", typeof", () => typeof p.count);
  attempt(label + ", plus one", () => p.count + 1);
  attempt(label + ", doubled", () => p.count * 2);
  attempt(label + ", as an integer", () => p.count | 0);
  attempt(label + ", compared", () => p.count > 0);
  attempt(label + ", is undefined", () => p.count === undefined);
  attempt(label + ", is null or undefined", () => p.count == null);
  attempt(label + ", is a number", () => typeof p.count === "number");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.count === "number").length);
  attempt(label + ", a method of the number", () => p.count.toFixed(1));
  attempt(label + ", a typed function", () => plusOne(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", incremented", () => ++p.count);
  attempt(label + ", stored", () => (p.count = 10));
  attempt(label + ", read after the store", () => p.count);
}

function briefCount(label: string, p: Part): void {
  attempt(label + ", used", () => p.count + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function countInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.count + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].count + 1);
  attempt(label + ", a result", () => make().count + 1);
}

function countInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.count + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function lengthOf(p: Part): number {
  return p.label.length;
}

function useLabel(label: string, p: Part): void {
  attempt(label + ", read", () => p.label);
  attempt(label + ", typeof", () => typeof p.label);
  attempt(label + ", its length", () => p.label.length);
  attempt(label + ", glued", () => p.label + "!");
  attempt(label + ", a method of the string", () => p.label.toUpperCase());
  attempt(label + ", compared", () => p.label === "part");
  attempt(label + ", is undefined", () => p.label === undefined);
  attempt(label + ", is a string", () => typeof p.label === "string");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.label === "string").length);
  attempt(label + ", a typed function", () => lengthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", appended to", () => (p.label += "?"));
  attempt(label + ", stored", () => (p.label = "stored"));
  attempt(label + ", read after the store", () => p.label);
}

function briefLabel(label: string, p: Part): void {
  attempt(label + ", used", () => p.label.length);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function labelInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.label.length);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].label.length);
  attempt(label + ", a result", () => make().label.length);
}

function labelInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.label.length;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function depthOf(p: Part): number {
  return p.inner.depth;
}

function useInner(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.inner);
  attempt(label + ", is undefined", () => p.inner === undefined);
  attempt(label + ", is null", () => p.inner === null);
  attempt(label + ", is truthy", () => !!p.inner);
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.inner === "object" && q.inner !== null).length);
  attempt(label + ", its member", () => p.inner.depth);
  attempt(label + ", its member plus one", () => p.inner.depth + 1);
  attempt(label + ", its keys", () => Object.keys(p.inner).join());
  attempt(label + ", a copy of it", () => JSON.stringify({ ...p.inner }));
  attempt(label + ", in", () => "depth" in p.inner);
  attempt(label + ", a pattern", () => (({ depth }: Inner) => depth)(p.inner));
  attempt(label + ", a typed function", () => depthOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", its member stored", () => (p.inner.depth = 9));
  attempt(label + ", its member after the store", () => p.inner.depth);
  attempt(label + ", replaced", () => (p.inner = { depth: 8 }).depth);
  attempt(label + ", its member after that", () => p.inner.depth);
}

function briefInner(label: string, p: Part): void {
  attempt(label + ", used", () => p.inner.depth);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function innerInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.inner.depth);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].inner.depth);
  attempt(label + ", a result", () => make().inner.depth);
}

function innerInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.inner.depth;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function run(p: Part): number {
  return p.action();
}

function useAction(label: string, p: Part): void {
  attempt(label + ", typeof", () => typeof p.action);
  attempt(label + ", is undefined", () => p.action === undefined);
  attempt(label + ", is a function", () => typeof p.action === "function");
  attempt(label + ", a callback asks", () => [p].filter(q => typeof q.action === "function").length);
  attempt(label + ", called", () => p.action());
  attempt(label + ", its result plus one", () => p.action() + 1);
  attempt(label + ", taken off and called", () => (f => f())(p.action));
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

function briefAction(label: string, p: Part): void {
  attempt(label + ", used", () => p.action());
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function actionInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.action());
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].action());
  attempt(label + ", a result", () => make().action());
}

function actionInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.action();
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function noteOf(p: Part): string {
  return p.note ?? "none";
}

function useNote(label: string, p: Part): void {
  attempt(label + ", read", () => p.note);
  attempt(label + ", typeof", () => typeof p.note);
  attempt(label + ", is undefined", () => p.note === undefined);
  attempt(label + ", is a string", () => typeof p.note === "string");
  attempt(label + ", or a default", () => p.note ?? "none");
  attempt(label + ", its length", () => p.note?.length);
  attempt(label + ", in", () => "note" in p);
  attempt(label + ", a typed function", () => noteOf(p));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", its method title", () => p.title());
  attempt(label + ", keys", () => Object.keys(p).join());
  attempt(label + ", json", () => JSON.stringify(p));
  attempt(label + ", a copy", () => JSON.stringify({ ...p }));
  attempt(label + ", stored", () => (p.note = "stored"));
  attempt(label + ", read after the store", () => p.note);
  attempt(label + ", deleted", () => delete p.note);
  attempt(label + ", read after the delete", () => p.note);
}

function briefNote(label: string, p: Part): void {
  attempt(label + ", used", () => (p.note ?? "none"));
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function noteInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => (holder.part.note ?? "none"));
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => (list[1].note ?? "none"));
  attempt(label + ", a result", () => (make().note ?? "none"));
}

function noteInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = (p.note ?? "none");
      if (typeof value === "string") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

function idPlusOne(p: Part): number {
  return p.id + 1;
}

function useId(label: string, p: Part): void {
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

function briefId(label: string, p: Part): void {
  attempt(label + ", used", () => p.id + 1);
  attempt(label + ", its method total", () => p.total());
  attempt(label + ", json", () => JSON.stringify(p));
}

function idInPlaces(label: string, make: () => Part): void {
  const holder = new Holder(make());
  attempt(label + ", in a field of a class", () => holder.part.id + 1);
  const list: Part[] = [fresh(), make(), fresh()];
  attempt(label + ", an element", () => list[1].id + 1);
  attempt(label + ", a result", () => make().id + 1);
}

function idInALoop(label: string, write: (p: Part) => void): void {
  const p = fresh();
  let honest = 0;
  let last: unknown = "nothing";
  attempt(label + ", written in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) write(p);
      const value = p.id + 1;
      if (typeof value === "number") honest++;
      last = value;
    }
    return "finished";
  });
  if (!quiet) console.log(label + ", rounds of the declared kind: " + honest + ", the last value: " + text(last));
}

const countWrites: [string, (p: Part) => void][] = [
  ["count becomes a string", p => { Object.defineProperties(p, { count: { value: "text" } }); }],
];

const labelWrites: [string, (p: Part) => void][] = [
  ["label becomes a number", p => { Object.defineProperties(p, { label: { value: 7 } }); }],
];

const innerWrites: [string, (p: Part) => void][] = [
  ["inner becomes null", p => { Object.defineProperties(p, { inner: { value: null } }); }],
];

const actionWrites: [string, (p: Part) => void][] = [
  ["action becomes a number", p => { Object.defineProperties(p, { action: { value: 5 } }); }],
];

const noteWrites: [string, (p: Part) => void][] = [
  ["note becomes a number", p => { Object.defineProperties(p, { note: { value: 5 } }); }],
];

const idWrites: [string, (p: Part) => void][] = [
  ["id becomes a string", p => { Object.defineProperties(p, { id: { value: "text" } }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
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
countInPlaces("", fresh);
countInALoop("", () => {});
labelInPlaces("", fresh);
labelInALoop("", () => {});
innerInPlaces("", fresh);
innerInALoop("", () => {});
actionInPlaces("", fresh);
actionInALoop("", () => {});
noteInPlaces("", fresh);
noteInALoop("", () => {});
idInPlaces("", fresh);
idInALoop("", () => {});
quiet = false;

useCount("untouched", fresh());

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

useCount("untouched afterwards", fresh());

useLabel("untouched", fresh());

for (const [label, write] of labelWrites) {
  const first = fresh();
  write(first);
  useLabel(label + ", a literal", first);
  const second = other();
  write(second);
  briefLabel(label + ", a literal written backwards", second);
  labelInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  labelInALoop(label, write);
}

useLabel("untouched afterwards", fresh());

useInner("untouched", fresh());

for (const [label, write] of innerWrites) {
  const first = fresh();
  write(first);
  useInner(label + ", a literal", first);
  const second = other();
  write(second);
  briefInner(label + ", a literal written backwards", second);
  innerInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  innerInALoop(label, write);
}

useInner("untouched afterwards", fresh());

useAction("untouched", fresh());

for (const [label, write] of actionWrites) {
  const first = fresh();
  write(first);
  useAction(label + ", a literal", first);
  const second = other();
  write(second);
  briefAction(label + ", a literal written backwards", second);
  actionInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  actionInALoop(label, write);
}

useAction("untouched afterwards", fresh());

useNote("untouched", fresh());

for (const [label, write] of noteWrites) {
  const first = fresh();
  write(first);
  useNote(label + ", a literal", first);
  const second = other();
  write(second);
  briefNote(label + ", a literal written backwards", second);
  noteInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  noteInALoop(label, write);
}

useNote("untouched afterwards", fresh());

useId("untouched", fresh());

for (const [label, write] of idWrites) {
  const first = fresh();
  write(first);
  useId(label + ", a literal", first);
  const second = other();
  write(second);
  briefId(label + ", a literal written backwards", second);
  idInPlaces(label, () => {
    const made = fresh();
    write(made);
    return made;
  });
  idInALoop(label, write);
}

useId("untouched afterwards", fresh());

export {};

// Flags: --aot-validate
// Define property gives a function member of a literal other values.
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

const actionWrites: [string, (p: Part) => void][] = [
  ["action becomes a number", p => { Object.defineProperty(p, "action", { value: 5 }); }],
  ["action becomes undefined", p => { Object.defineProperty(p, "action", { value: undefined }); }],
  ["action becomes a string", p => { Object.defineProperty(p, "action", { value: "text" }); }],
  ["action becomes a function that answers a string", p => { Object.defineProperty(p, "action", { value: () => "text" }); }],
  ["action becomes a class", p => { Object.defineProperty(p, "action", { value: class {} }); }],
  ["action becomes an object with call", p => { Object.defineProperty(p, "action", { value: { call: () => 1 } }); }],
  ["action becomes a bound built-in", p => { Object.defineProperty(p, "action", { value: Math.max.bind(null, 1, 2) }); }],
  ["action becomes an async function", p => { Object.defineProperty(p, "action", { value: async () => 1 }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useAction("", fresh());
  briefAction("", other());
}
actionInPlaces("", fresh);
actionInALoop("", () => {});
quiet = false;

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

export {};

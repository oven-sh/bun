// Flags: --aot-validate
// Define property gives a number member of a literal other values.
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

const countWrites: [string, (p: Part) => void][] = [
  ["count becomes a string", p => { Object.defineProperty(p, "count", { value: "text" }); }],
  ["count becomes a string of digits", p => { Object.defineProperty(p, "count", { value: "12" }); }],
  ["count becomes undefined", p => { Object.defineProperty(p, "count", { value: undefined }); }],
  ["count becomes null", p => { Object.defineProperty(p, "count", { value: null }); }],
  ["count becomes true", p => { Object.defineProperty(p, "count", { value: true }); }],
  ["count becomes a fraction", p => { Object.defineProperty(p, "count", { value: 1.5 }); }],
  ["count becomes an object with valueOf", p => { Object.defineProperty(p, "count", { value: { valueOf: () => 42 } }); }],
  ["count becomes a big integer", p => { Object.defineProperty(p, "count", { value: 10n }); }],
  ["count becomes an array", p => { Object.defineProperty(p, "count", { value: [7] }); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useCount("", fresh());
  briefCount("", other());
}
countInPlaces("", fresh);
countInALoop("", () => {});
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

export {};

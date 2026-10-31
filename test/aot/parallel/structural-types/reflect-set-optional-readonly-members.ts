// Flags: --aot-validate
// Reflect set gives optional and readonly members of a literal other values.
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

const noteWrites: [string, (p: Part) => void][] = [
  ["note becomes a number", p => { Reflect.set(p, "note", 5); }],
  ["note becomes null", p => { Reflect.set(p, "note", null); }],
  ["note becomes undefined", p => { Reflect.set(p, "note", undefined); }],
  ["note becomes an object with a length", p => { Reflect.set(p, "note", { length: 1 }); }],
];

const idWrites: [string, (p: Part) => void][] = [
  ["id becomes a string", p => { Reflect.set(p, "id", "text"); }],
  ["id becomes another number", p => { Reflect.set(p, "id", 9); }],
  ["id becomes undefined", p => { Reflect.set(p, "id", undefined); }],
  ["id becomes a fraction", p => { Reflect.set(p, "id", 0.5); }],
];

quiet = true;
for (let i = 0; i < 2000; i++) {
  useNote("", fresh());
  briefNote("", other());
  useId("", fresh());
  briefId("", other());
}
noteInPlaces("", fresh);
noteInALoop("", () => {});
idInPlaces("", fresh);
idInALoop("", () => {});
quiet = false;

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

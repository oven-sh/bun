// Forty holders a row, kept in a list, each with a member that nothing reads. The member is declared by an interface that records, lists, functions, maps and classes all satisfy.
interface Sized {
  length: number;
}
interface Named {
  name: string;
}
interface Counted {
  size: number;
}
type Holder = { read: number };
const holders: Holder[] = [];
const rows: { name: string; weak: WeakRef<object>[] }[] = [];
function row(name: string, make: (n: number, weak: WeakRef<object>[]) => Holder) {
  const weak: WeakRef<object>[] = [];
  for (let n = 0; n < 40; n++) holders.push(make(n, weak));
  rows.push({ name, weak });
}
function holdSized(n: number, keep: Sized): Holder {
  return { read: n, keep } as Holder;
}
function holdNamed(n: number, keep: Named): Holder {
  return { read: n, keep } as Holder;
}
function holdCounted(n: number, keep: Counted): Holder {
  return { read: n, keep } as Holder;
}
function holdAny<T>(n: number, keep: T): Holder {
  return { read: n, keep } as Holder;
}
class SizedHolder {
  constructor(
    public read: number,
    public keep: Sized,
  ) {}
}
class NamedHolder {
  constructor(
    public read: number,
    public keep: Named,
  ) {}
}
row("a record as Sized", (n, weak) => holdSized(n, { length: n }));
row("a list as Sized", (n, weak) => {
  const w = [n];
  weak.push(new WeakRef(w));
  return holdSized(n, w);
});
row("a tuple as Sized", (n, weak) => {
  const w: [number, string] = [n, "x"];
  weak.push(new WeakRef(w));
  return holdSized(n, w);
});
row("a function as Sized", (n, weak) => {
  const w = (a: number) => a + n;
  weak.push(new WeakRef(w));
  return holdSized(n, w);
});
row("a typed array as Sized", (n, weak) => {
  const w = new Uint8Array(4);
  weak.push(new WeakRef(w));
  return holdSized(n, w);
});
row("a record as Named", (n, weak) => holdNamed(n, { name: "r" + n }));
row("a function as Named", (n, weak) => {
  const w = function named() {
    return n;
  };
  weak.push(new WeakRef(w));
  return holdNamed(n, w);
});
row("a class as Named", (n, weak) => {
  const w = class Made {
    v = n;
  };
  weak.push(new WeakRef(w));
  return holdNamed(n, w);
});
row("an error as Named", (n, weak) => {
  const w = new Error("e" + n);
  weak.push(new WeakRef(w));
  return holdNamed(n, w);
});
row("a record as Counted", (n, weak) => holdCounted(n, { size: n }));
row("a map as Counted", (n, weak) => {
  const w = new Map<number, number>();
  weak.push(new WeakRef(w));
  return holdCounted(n, w);
});
row("a set as Counted", (n, weak) => {
  const w = new Set<number>();
  weak.push(new WeakRef(w));
  return holdCounted(n, w);
});
row("a blob as Counted", (n, weak) => {
  const w = new Blob(["b" + n]);
  weak.push(new WeakRef(w));
  return holdCounted(n, w);
});
row("a record as T", (n, weak) => holdAny(n, { t: n }));
row("a list as T", (n, weak) => {
  const w = [n, n];
  weak.push(new WeakRef(w));
  return holdAny(n, w);
});
row("a map as T", (n, weak) => {
  const w = new Map<string, number>();
  weak.push(new WeakRef(w));
  return holdAny(n, w);
});
row("a list in an instance", (n, weak) => {
  const w = [n, n, n];
  weak.push(new WeakRef(w));
  return new SizedHolder(n, w);
});
row("a record in an instance", (n, weak) => new SizedHolder(n, { length: n }));
row("a function in an instance", (n, weak) => {
  const w = function other() {
    return n;
  };
  weak.push(new WeakRef(w));
  return new NamedHolder(n, w);
});
row("a record in an instance, Named", (n, weak) => new NamedHolder(n, { name: "i" + n }));
for (let round = 0; round < 6; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
}
let sum = 0;
for (const holder of holders) sum += holder.read;
for (const { name, weak } of rows)
  console.log(name + ":", weak.filter(w => w.deref() !== undefined).length, "of", weak.length);
console.log("sum", sum, holders.length);

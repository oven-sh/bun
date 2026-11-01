// Fields with declared types are defined with values of other types, as accessors, and with other attributes; typed reads follow.
class Typed { count: number = 1; name: string = "n"; flag: boolean = true; inner: { v: number } = { v: 1 }; maybe?: number; }
function read(o: Typed): string { return [o.count, o.name, o.flag, o.inner && o.inner.v, o.maybe].join(); }
function list(o: object): string {
  return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k)!; return String(k) + ("value" in d ? "=" + JSON.stringify(d.value) + (d.writable ? "W" : "w") : "()") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ");
}
const steps: ((o: Typed, turn: number) => unknown)[] = [
  (o, turn) => Object.defineProperty(o, "count", { value: turn }),
  (o, turn) => Object.defineProperty(o, "count", { value: turn + 0.5 }),
  (o, turn) => Object.defineProperty(o, "count", { value: 2 ** 40 + turn }),
  (o, turn) => Object.defineProperty(o, "count", { value: "text" as any }),
  (o, turn) => Object.defineProperty(o, "count", { get() { return turn; } }),
  (o, turn) => Object.defineProperty(o, "count", { writable: false }),
  (o, turn) => Object.defineProperty(o, "count", { enumerable: false }),
  (o, turn) => Object.defineProperty(o, "name", { value: "other" + turn }),
  (o, turn) => Object.defineProperty(o, "name", { value: undefined as any }),
  (o, turn) => Object.defineProperty(o, "flag", { value: null as any }),
  (o, turn) => Object.defineProperty(o, "flag", { value: false, writable: true, enumerable: true, configurable: true }),
  (o, turn) => Object.defineProperty(o, "inner", { value: { v: turn } }),
  (o, turn) => Object.defineProperty(o, "inner", { value: { w: turn } as any }),
  (o, turn) => Object.defineProperty(o, "maybe", { value: turn, writable: true, enumerable: true, configurable: true }),
  (o, turn) => Object.defineProperty(o, "maybe", { value: turn }),
  (o, turn) => Object.defineProperty(o, "maybe", { get() { return turn; }, enumerable: true, configurable: true }),
  (o, turn) => Reflect.defineProperty(o, "maybe", { value: "text", enumerable: true }),
  (o, turn) => Object.defineProperties(o, { count: { value: turn }, maybe: { value: turn, enumerable: true }, name: { enumerable: false } }),
];
for (let turn = 0; turn < 4; turn++) {
  for (let index = 0; index < steps.length; index++) {
    const o = new Typed();
    steps[index](o, turn);
    let stored = "";
    try { o.count = 7; o.maybe = 8; o.name = "stored"; stored = "stored"; } catch (e) { stored = (e as Error).constructor.name; }
    console.log(turn, index, read(o), stored, "#", list(o), "#", JSON.stringify(o), JSON.stringify({ ...o }));
  }
}

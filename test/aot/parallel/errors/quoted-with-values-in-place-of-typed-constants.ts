// What `bun <file>` prints in place of a name is found by where the name stands in the file, and the text that an executable keeps has no types.
type Box = { value: { deep: number } | null; run?: (n: number) => void };
function tell(cases: Record<string, () => unknown>) {
  for (const [label, run] of Object.entries(cases)) {
    try {
      run();
      console.log(label + ": nothing thrown");
    } catch (error) {
      console.log(label + ": " + (error as Error).message);
    }
  }
}
function lookup(x: Box | null): Box | null { return x; }
function initializer(x: Box | null): unknown { const r: Box | null = lookup(x); return r!.value; }
function cast(x: unknown): unknown { const r = x as Box; return (r as Box).value!.deep; }
function key<T extends object>(o: T | null): unknown { const k: string = "name"; return (o as any)[k as string]; }
function base(): unknown { const holder: Box | null = null; return holder!.value; }
function onLines(
  o: Box | null,
  other: Box,
): unknown {
  const first: number = 0x10;
  const r: Box | null =
    lookup(o);
  return other.run!(first) ?? r!.value;
}
class Holder {
  private readonly box: Box | null = null;
  read(): unknown { const b: Box | null = this.box; return b!.value; }
  static make(o: Box | null): unknown { const key = "value" as const; return o![key]; }
}
enum Color { Red = "red", Green = "green" }
function member(o: any): unknown { return o[Color.Red]; }
tell({
  initializer: () => initializer(null),
  cast: () => cast({ value: null }),
  key: () => key(null),
  base: () => base(),
  "on lines": () => onLines(null, { value: null, run() {} }),
  "on lines, the call": () => onLines(null, { value: null }),
  read: () => new Holder().read(),
  make: () => Holder.make(null),
  member: () => member(null),
});

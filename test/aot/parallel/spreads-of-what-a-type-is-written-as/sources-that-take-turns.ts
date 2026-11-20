type State = { a: number; b: number };
function written(state: State, c: number) { return { ...state, c }; }
(globalThis as any).keep = written;
const widen: typeof written = (globalThis as any).keep;
(globalThis as any).literal = { a: 0, b: 0, c: 0 };
function show(value: object) {
  return Reflect.ownKeys(value).map(key => {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    const held = Object.is(d.value, -0) ? "-0" : typeof d.value === "object" && d.value ? "object" : String(d.value);
    return String(key) + "=" + held + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
  }).join(" ");
}
const sources: any[] = [{ a: 1, b: 2 }, { b: 3, a: 4 }, { a: 5, b: 6, c: 7 }, { a: 8, b: 9, z: 10 }, null, { a: 11 }, { a: "x", b: 12 }, Object.freeze({ a: 13, b: 14 })];
const seen = new Map<string, number>();
for (let i = 0; i < 8000; i++) { const text = show(widen(sources[i % sources.length], i & 1)); seen.set(text, (seen.get(text) ?? 0) + 1); }
for (const [text, count] of seen) console.log(count, text);

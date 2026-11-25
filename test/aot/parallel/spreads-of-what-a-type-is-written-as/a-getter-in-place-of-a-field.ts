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
const calls: string[] = [];
const got: any = { a: 1, b: 2 };
console.log(show(widen(got, 3)));
Object.defineProperty(got, "a", { get() { calls.push("a"); return 7; }, enumerable: true, configurable: true });
console.log(show(widen(got, 3)), calls.join());
Object.defineProperty(got, "b", { get() { calls.push("b"); throw new Error("no b"); }, enumerable: true, configurable: true });
try { widen(got, 3); } catch (error) { console.log((error as Error).message, calls.join()); }

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
const grown: any = { a: 1, b: 2 };
console.log(show(widen(grown, 3)));
grown.z = 9;
console.log(show(widen(grown, 3)));
grown.c = 8;
console.log(show(widen(grown, 3)));

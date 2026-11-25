type State = { a: number; b: number };
function widen(state: State, c: number) { return { ...state, c }; }
(globalThis as any).keep = widen;
function show(value: object) {
  return Reflect.ownKeys(value).map(key => {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    const held = Object.is(d.value, -0) ? "-0" : typeof d.value === "object" && d.value ? "object" : String(d.value);
    return String(key) + "=" + held + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "");
  }).join(" ");
}
const states: State[] = [];
for (let i = 0; i < 64; i++) states.push({ a: i, b: i * 2 });
let total = 0;
for (let i = 0; i < 20000; i++) { const wide = widen(states[i & 63], i); total += wide.a + wide.b + wide.c; }
console.log(total, show(widen(states[5], 9)));

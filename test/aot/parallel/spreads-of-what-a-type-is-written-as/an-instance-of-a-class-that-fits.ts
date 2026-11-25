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
class Pair { a = 1; b = 2; get sum() { return this.a + this.b; } twice() { return this.a * 2; } }
class Wider extends Pair { d = 4; #hidden = 5; peek() { return this.#hidden; } }
console.log(show(widen(new Pair(), 3)), "|", show(widen(new Wider(), 3)), Object.getPrototypeOf(widen(new Pair(), 3)) === Object.prototype);

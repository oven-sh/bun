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
const parsed = JSON.parse('{ "a": 1, "__proto__": { "x": 1 }, "b": 2 }');
const wide = widen(parsed, 3);
console.log(show(wide), Object.getPrototypeOf(wide) === Object.prototype, (wide as any).x);
const above: any = Object.create({ a: 100, inherited: 1 });
above.b = 2;
console.log(show(widen(above, 3)));
const bare: any = Object.create(null);
bare.a = 1; bare.b = 2;
console.log(show(widen(bare, 3)), Object.getPrototypeOf(widen(bare, 3)) === Object.prototype);

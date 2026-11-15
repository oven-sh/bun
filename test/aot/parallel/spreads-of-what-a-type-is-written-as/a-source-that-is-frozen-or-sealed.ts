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
const frozen = Object.freeze({ a: 1, b: 2 });
const sealed = Object.seal({ a: 3, b: 4 });
const closed = Object.preventExtensions({ a: 5, b: 6 });
for (const source of [frozen, sealed, closed]) {
  const wide = widen(source, 7);
  wide.a = 70;
  (wide as any).more = 1;
  console.log(show(wide), Object.isFrozen(wide), Object.isSealed(wide), Object.isExtensible(wide), show(source));
}

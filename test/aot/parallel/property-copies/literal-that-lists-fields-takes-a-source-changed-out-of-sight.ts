// A literal that lists a field takes a spread of a typed source over which an accessor was laid, from which a key was deleted, and to which a key was added, each through a name that the compiler cannot follow.
type State = { a: number; b: number };
function widen(state: State, c: number) {
  return { c, ...state };
}
function make(i: number): State {
  return { a: i, b: i + 1 };
}
function deed(how: number) {
  (globalThis as any).held = make(1);
  const o = (globalThis as any).held;
  if (how === 0) Object.defineProperty(o, "a", { get: () => "got", enumerable: true, configurable: true });
  if (how === 1) delete o.a;
  if (how === 2) o.extra = "added";
  if (how === 3) Object.defineProperty(o, "b", { enumerable: false });
  if (how === 4) {
    delete o.a;
    o.a = "again";
  }
  if (how === 5) o[Symbol.for("tag")] = "symbol";
  return o as State;
}
for (let how = 0; how < 7; how++) {
  const made = widen(deed(how), 0);
  console.log(how, JSON.stringify(made), Object.keys(made).join(), Object.getOwnPropertySymbols(made).length);
}
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(widen(i % 2 ? make(i) : deed(i % 7), i));
console.log(last);

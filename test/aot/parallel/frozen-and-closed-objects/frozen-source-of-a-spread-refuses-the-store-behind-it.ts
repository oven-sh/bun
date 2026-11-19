// A frozen object is spread like any other: it passes the tests of its shape, of the order of its keys and of what lies beside its slots. The store that stands behind the spread still has to ask whether it is frozen.
type State = { a: number; b: number };
function make(i: number): State {
  return { a: i, b: i + 1 };
}
function deed(state: State, c: number) {
  const made = { c, ...state };
  state.a = c;
  return made.a + state.a;
}
function tell(state: State, c: number) {
  try {
    return String(deed(state, c));
  } catch (error) {
    return (error as Error).name;
  }
}
const open = make(1);
console.log(tell(open, 10), JSON.stringify(open));
const frozen = Object.freeze(make(2));
console.log(tell(frozen, 20), JSON.stringify(frozen), Object.isFrozen(frozen));
const sealed = Object.seal(make(3));
console.log(tell(sealed, 30), JSON.stringify(sealed), Object.isSealed(sealed));
let last = "";
for (let i = 0; i < 300; i++) last = tell(i % 2 ? make(i) : Object.freeze(make(i)), i) + "|" + tell(frozen, i);
console.log(last, JSON.stringify(frozen));

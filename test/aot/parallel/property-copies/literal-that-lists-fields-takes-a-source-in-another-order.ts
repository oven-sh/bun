// A literal that lists a field takes a spread of a typed source that got its keys in another order than its type declares.
type State = { a: number; b: number };
function widen(state: State, c: number) {
  return { c, ...state };
}
function deed(): State {
  const o = JSON.parse("{}");
  o.b = 2;
  o.a = 1;
  return o;
}
function swapped(): State {
  return { b: 4, a: 3 };
}
console.log(Object.keys(widen({ a: 1, b: 2 }, 0)).join(), Object.keys(widen(deed(), 0)).join(), Object.keys(widen(swapped(), 0)).join());
let last = "";
for (let i = 0; i < 300; i++) last = JSON.stringify(widen(i % 3 === 0 ? deed() : i % 3 === 1 ? swapped() : { a: i, b: i }, i));
console.log(last);
console.log(JSON.stringify(widen(swapped(), 9)));

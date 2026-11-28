// The fields of a record that a loop replaces are carried around it also where another function makes such records of a rest, whose names come in another order.
// STATISTIC: SlotsOfObjectsCarriedAroundLoops >= 4
function replaced(n: number) {
  let state = { a: 0, b: 1, c: 2, d: 3 };
  for (let i = 0; i < n; i++) state = { a: i, b: state.b, c: state.c, d: state.d };
  return state.a + state.d;
}
function copied(n: number) {
  let state = { a: 0, b: 1, c: 2, d: 3 };
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const { a, ...others } = state;
    sum += a;
    state = { ...others, a: i };
  }
  return sum + state.d;
}
const n = JSON.parse("[0, 1, 2, 10, 1000]") as number[];
for (const each of n) console.log(replaced(each), copied(each));

// The literals meet behind a call, in a field and in a variable of a loop.
const show = value => JSON.stringify(value, (key, each) => (each === undefined ? "undefined" : each));
function pick(which) {
  if (which === 0) return [5, 6, 7];
  return ["a", "b"];
}
function answeredByAFunction(which) { return pick(which).find(each => each !== 1); }
function pickOrNothing(which) {
  if (which === 0) return [];
  return [1.5, 2.5];
}
function answeredOrNothing(which) { return pickOrNothing(which).find(each => each !== 1); }
class Box {
  list = [5, 6, 7];
}
function inAField(which) {
  const box = new Box();
  if (which) box.list = ["a", "b"];
  return box.list.find(each => each !== 1);
}
function inALoop(turns) {
  const out = [];
  let list = [5, 6, 7];
  for (let turn = 0; turn < turns; turn++) {
    out.push(list.find(each => each !== 1));
    list = turn % 2 ? ["a", "b"] : [1.5];
  }
  return out;
}
function inALoopWithNothing(turns) {
  const out = [];
  let list = [];
  for (let turn = 0; turn < turns; turn++) {
    out.push(list.find(each => each !== 1));
    list = turn % 2 ? [8, 9] : ["c", "d", "e"];
  }
  return out;
}
console.log(show([answeredByAFunction(0), answeredByAFunction(1)]));
console.log(show([answeredOrNothing(0), answeredOrNothing(1)]));
console.log(show([inAField(0), inAField(1)]));
console.log(show(inALoop(5)), show(inALoopWithNothing(5)));
const seen = [];
for (let turn = 0; turn < 3000; turn++) {
  const found = answeredByAFunction(turn % 2);
  if (turn < 4) seen.push(found);
}
console.log(show(seen));

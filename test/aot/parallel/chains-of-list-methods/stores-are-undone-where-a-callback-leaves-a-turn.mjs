// A turn of a loop stores, and then a callback that is copied into the loop finds what the loop does not expect. The turn is run again as written: what it has stored is as before it.
class Box { constructor() { this.count = 0; this.other = 0; } }
class Static { static count = 0; }
const box = new Box();
globalThis.binding = 0;
function inGlobal(turns, odd) {
  const list = [3, 1, 2];
  for (let j = 0; j < turns; j++) {
    binding = j;
    binding = list.reduce((sum, value) => sum + (value === odd ? "y" : value), 0);
  }
  return binding + " " + list;
}
function inField(turns, odd) {
  const list = [3, 1, 2];
  for (let j = 0; j < turns; j++) {
    box.count = j;
    box.count = list.reduce((sum, value) => sum + (value === odd ? "y" : value), 0);
  }
  return box.count + " " + list;
}
function inStatic(turns, odd) {
  const list = [3, 1, 2];
  for (let j = 0; j < turns; j++) {
    Static.count = j;
    Static.count = list.reduce((sum, value) => sum + (value === odd ? "y" : value), 0);
  }
  return Static.count + " " + list;
}
function inInnerLoop(turns, odd) {
  let sum = 0;
  const one = [3, 1, 2], two = [0.5, 1, 2];
  outer: for (let j = 0; j < turns; j++) {
    for (let w = 0; w < 2; w++) {
      if (j + w === 9) continue outer;
      box.count = j + 1;
      box.other = j;
      sum = two.reduce((total, value) => total + (value === odd ? undefined : value), 0);
      if (sum > 90) break outer;
    }
  }
  return sum + " " + one + " " + two + " " + box.count + " " + box.other;
}
function go(turns, odd) {
  for (const run of [inGlobal, inField, inStatic, inInnerLoop]) console.log(run.name, run(turns | 0, odd | 0));
}
setTimeout(go, 1, 3, 0);
setTimeout(go, 20, 3, 1);
setTimeout(go, 40, 5, 2);

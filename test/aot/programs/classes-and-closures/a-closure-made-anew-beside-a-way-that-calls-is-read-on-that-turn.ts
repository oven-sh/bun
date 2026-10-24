// The makers are read by `made[next++]`, in two loops one inside the other, and three closures deep. What each closure captured is read on the turn that made it.
function twoVariables() {
  const made: (() => () => number)[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) made.push(() => () => i * 10 + j);
  const seen: number[] = [];
  let next = 0;
  while (next < made.length) seen.push(made[next++]()());
  return seen;
}
function aNameOfAnObject() {
  const made: (() => () => number)[] = [];
  for (const name in { a: 3, bc: 4 }) made.push(() => () => name.length);
  const seen: number[] = [];
  let next = 0;
  while (next < made.length) seen.push(made[next++]()());
  return seen;
}
function readTwiceEach() {
  const made: (() => () => number)[] = [];
  for (let i = 0; i < 3; i++) made.push(() => () => i);
  const seen: number[] = [];
  for (const each of made) for (let twice = 0; twice < 2; twice++) seen.push(each()());
  return seen;
}
function threeDeep() {
  const made = [0, 2].map((each, at) => () => () => () => at);
  let sum = 0;
  for (const each of made) sum += each()()();
  return sum;
}
function once() { return [twoVariables(), aNameOfAnObject(), readTwiceEach(), threeDeep()].map(String).join(" | "); }
console.log(once());
let last = "";
for (let turn = 0; turn < 200; turn++) last = once();
console.log(last);

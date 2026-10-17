// A callback that captures variables and returns nothing, a number or a boolean, handed to what only calls it: its variables lie in the frame of the function that made it. Its entry for callers that know nothing of it reads them out of the closure and goes on into the body: it makes no frame and no call.
// ENTRY-SIZE< addsToSum 24 16
// ENTRY-SIZE< scaled 24 16
function sums(list) {
  let sum = 0;
  list.forEach(function addsToSum(value) { sum += value; });
  return sum;
}
function countsOver(list, limit) {
  return list.filter(function isOverLimit(value) { return value > limit; }).length;
}
function scales(list, factor) {
  return list.map(function scaled(value) { return value * factor; }).join();
}
function nests(lists) {
  let total = 0;
  lists.forEach(list => {
    let own = 0;
    list.forEach(value => { own += value; total += 1; });
    total += own;
  });
  return total;
}
function throwsInTheMiddle(list) {
  let seen = 0;
  try {
    list.forEach(value => { if (value === 2) throw new Error("two after " + seen); seen += value; });
  } catch (error) {
    return error.message + " " + seen;
  }
  return seen;
}
function keepsTheCallback(list) {
  let sum = 0;
  const add = value => { sum += value; };
  list.forEach(add);
  return [add, () => sum];
}
function walksSomethingElse(walked) {
  let sum = 0;
  walked.forEach(value => { sum += value; });
  return sum;
}
function recursive(depth) {
  let sum = depth;
  if (depth) [1, 2].forEach(value => { sum += value + recursive(depth - 1); });
  return sum;
}
const lists = [[1, 2, 3], [], [0.5, 1.5], ["a", "b"], [1, , 3]];
for (const list of lists) console.log(String(sums(list)), countsOver(list, 1), scales(list, 2), throwsInTheMiddle(list));
console.log(nests([[1, 2], [3], []]));
const [add, read] = keepsTheCallback([1, 2]);
add(10);
console.log(read());
const held = [];
console.log(walksSomethingElse({ forEach(f) { held.push(f); f(1); f(2); } }), walksSomethingElse(new Set([4, 5])), walksSomethingElse(new Map([["a", 6]])));
held[0](100);
console.log(recursive(4));

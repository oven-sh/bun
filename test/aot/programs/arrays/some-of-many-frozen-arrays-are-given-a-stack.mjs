// One loop sums frozen arrays before and after Error.captureStackTrace() has defined `stack` on every other one.
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}
const lists = [];
for (let i = 0; i < 50; i++) lists.push(Object.freeze([i, i + 1, i + 2]));
let total = 0;
for (const list of lists) total += sum(list);
for (let i = 0; i < 50; i += 2) Error.captureStackTrace(lists[i]);
for (const list of lists) total += sum(list);
console.log(
  total,
  lists.filter(list => "stack" in list).length,
  lists.filter(list => Object.isFrozen(list)).length,
  lists.filter(list => list.stack === undefined).length,
);
for (const list of lists) {
  try {
    list[0] = 100;
  } catch {}
}
total = 0;
for (const list of lists) total += sum(list);
console.log(total);

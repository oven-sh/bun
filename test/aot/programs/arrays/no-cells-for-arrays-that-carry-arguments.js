// 10,000 rounds of calls that hand over an array which is made for the call alone and which the callee only reads: a literal, a literal that the callee hands on, the surplus arguments of a function that uses `arguments`,
// and the rest array of a function that is called through a value. One call in each round keeps its array. Each function calls itself, so that it is not taken into its caller.
// object-census.test.ts runs it without collections, so that the census at exit counts every array that was made. The output is that of plain Bun.
let sum = 0;
const kept = [];

function total(list, depth) {
  if (depth > 0) return total(list, depth - 1);
  let result = list.length;
  for (let i = 0; i < list.length; i++) result += list[i].n;
  return result;
}

function keeps(list, depth) {
  if (depth > 0) return keeps(list, depth - 1);
  kept.push(list);
  return list.length;
}

function counts(a, depth) {
  // No tail call: the frame that the surplus arguments lie in has to be there while the callee runs.
  if (depth > 0) return counts(a, depth - 1, arguments[2], arguments[3], arguments[4]) + 0;
  return arguments.length + arguments[2].n + arguments[4].n;
}

const table = {
  rest(depth, ...values) {
    let result = values.length;
    for (let i = 0; i < values.length; i++) result += values[i].n;
    return result;
  },
};
const names = ["rest"];

for (let i = 0; i < 10000; i++) {
  const a = { n: i };
  const b = { n: 1 };
  sum += total([a, b, a], 1) + keeps([a, b, a, b], 1) + counts(a, 1, a, b, a) + table[names[i % names.length]](0, a, b, a, b, a);
}
console.log(sum, kept.length, kept[9999][0].n);

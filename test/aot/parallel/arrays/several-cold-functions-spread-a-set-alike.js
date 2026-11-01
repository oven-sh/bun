// Functions that nobody knows to run often and that hold the same `[...set]`: each still makes its list with the members in it, by the stub, and none enters the run time to append them.
// COUNT: operation:operationAOTAppendMembers = 0
// COUNT: operation:operationAOTNewArrayOfMembers <= 200
const filled = new Set();
for (let n = 0; n < 5; n++) filled.add(n * 3);
const more = new Set();
for (let n = 0; n < 40; n++) more.add(n * 7);
const count = (...all) => all.length;
const ways = {
  first: i => [...filled][i % 5],
  second: i => [...more][i % 40],
  third: i => [...filled][(i + 1) % 5],
  fourth: i => [...more][(i + 1) % 40],
  fifth: i => [...filled][(i + 2) % 5] + [...more][(i + 2) % 40],
  largest: i => Math.max(...filled) + i,
  largestOfMore: i => Math.max(...more) + i,
  least: i => Math.min(...filled) + i,
  leastOfMore: i => Math.min(...more) + i,
  counted: i => count(...filled) + i,
  countedMore: i => count(...more) + i,
  last: i => [...more].at(-1) + i,
};
const turn = ways[process.argv[2] ?? "first"];
const turns = Number(process.argv[3] ?? 300);
let sum = 0;
for (let i = 0; i < turns; i++) sum += turn(i);
console.log(sum);

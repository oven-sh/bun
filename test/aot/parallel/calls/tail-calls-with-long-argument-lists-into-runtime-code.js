// Tail calls that alternate between compiled code and functions made by `new Function` pass over 4,096 arguments on without using more stack at each hop.
// Plain Bun prints the same or, depending on when the JIT compiles the two functions, a RangeError in some lines.
const end = process.argv.length > 99 ? "x" : ";";
const { bounce } = class {
  static bounce(self, next, n, ...all) { return bounces(self, next, n - 1, ...all); }
};
const digest = new Function("...all", "let sum = 0; for (const value of all) sum = (sum * 31 + value) % 1000003; return all.length + ',' + sum" + end);
const bounces = new Function("return class { static bounces(self, next, n, ...all) { return n ? self(self, next, n, ...all) : next(...all); } }.bounces" + end)();
function run(label, list) {
  try { console.log(label, list.length, bounce(bounce, digest, 400, ...list)); } catch (error) { console.log(label, list.length, error.constructor.name); }
}
for (const length of [10, 4097, 4100, 6000, 20000, 60000]) {
  run("integers", Array.from({ length }, (_, at) => at % 89));
  run("fractions", Array.from({ length }, (_, at) => (at % 89) + 0.5));
  run("values", Array.from({ length }, (_, at) => (at % 7 ? at % 89 : true)));
}
const holes = Array.from({ length: 5000 }, (_, at) => at % 89);
delete holes[4500];
run("holes", holes);

// Not in tail position: every level keeps its list.
function nest(depth, ...all) { return depth ? 1 + nests(depth - 1, ...all) : all.length; }
const nests = new Function("nest", "return function nests(depth, ...all) { return depth ? 1 + nest(depth - 1, ...all) : all.length; }" + end)(nest);
console.log(nest(20, ...Array.from({ length: 5000 }, (_, at) => at)));

/* Output:
integers 10 10,364560
fractions 10 10,832950
values 10 10,200836
integers 4097 4097,218307
fractions 4097 4097,888299.5
values 4097 4097,743138
integers 4100 4100,567340
fractions 4100 4100,254524
values 4100 4100,760756
integers 6000 6000,214867
fractions 6000 6000,83833
values 6000 6000,691490
integers 20000 20000,676397
fractions 20000 20000,698447
values 20000 20000,539335
integers 60000 60000,266469
fractions 60000 60000,604073
values 60000 60000,599758
holes 5000 5000,NaN
5020
*/

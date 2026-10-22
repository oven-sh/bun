// 20,000 calls by name of a function that hands its `arguments` to native code, none of them with a surplus argument. The function calls itself, so that it is not taken into its caller.
// object-census.test.ts runs it without collections, so that the census at exit counts every array that was made, and looks for empty ones. The output is that of plain Bun.
let sum = 0;
const seen = new Set();

function look(a, depth) {
  if (depth > 0) return look(a + 1, depth - 1);
  seen.add(Object.keys(arguments).length);
  sum += arguments.length + a;
}

for (let i = 0; i < 10000; i++) look(i, 1);
console.log(sum, [...seen].join());

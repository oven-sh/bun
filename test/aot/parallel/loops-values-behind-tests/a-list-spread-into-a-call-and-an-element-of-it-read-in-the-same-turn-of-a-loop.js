// Flags: --aot-validate
// The test of the storage for the element read stands in front of the loop. The spread is expanded into reads of the same list, and their slow way reads by the general road: a read of a list that nothing has touched writes nothing.
function sum3(a, b, c) { return a + b + c; }
function walk(list) {
  let count = 0, sum = 0;
  for (let i = 0; i < 3; i++) { sum += sum3(...list); if (list[list.length - 1]?.toFixed === undefined) count++; }
  return sum + ";" + count;
}
console.log(walk([-1, 7, ([])[0]]), walk([1, 2, 3].map(x => x)), walk([1.5, 2.5, 3.5]));

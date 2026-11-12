// some, every, find, findIndex and reduce by value keep their frame while their helper goes up a list of fractions: one frame more a level. A recursion through them to a fixed depth ends as it does without ahead-of-time compilation.
const fractions = [0.5];
function down(method, depth) {
  if (depth === 0) return 0;
  let deepest = 0;
  Array.prototype[method].call(fractions, () => { deepest = down(method, depth - 1) + 1; return false; }, 0);
  return deepest;
}
for (const method of ["some", "every", "find", "findIndex", "reduce", "map", "filter", "forEach"]) console.log(method, down(method, 2000));

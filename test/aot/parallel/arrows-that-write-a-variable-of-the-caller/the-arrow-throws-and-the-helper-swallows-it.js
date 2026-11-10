function each(list, visit) {
  for (let at = 0; at < list.length; at++) {
    try { visit(list[at]); } catch (e) { }
  }
}
function run(list, reps) {
  let sum = 0;
  for (let r = 0; r < reps; r++)
    each(list, v => { sum += v; if (v === 2) throw new Error("two"); sum += 100; });
  return sum;
}
console.log(run(JSON.parse("[1,2,3]"), JSON.parse("2")));
// A function that runs once has its scope in words of the instance: it is called again, so that it makes a scope.
console.log(run(JSON.parse("[2,2.5]"), JSON.parse("3")));

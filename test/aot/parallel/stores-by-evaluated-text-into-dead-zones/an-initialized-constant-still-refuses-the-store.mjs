// behind its declaration a constant refuses the store with a TypeError and keeps its value, on every road
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
function probe() {
  const late = 1;
  const all = [];
  for (const text of ["late = 2", "[late] = [2]", "late += 2", "late++", "for (late of [5]);", "for (late in { a: 5 });", "(() => { late = 2; })()"]) all.push(attempt(() => eval(text)) + " | " + late);
  return all.join("\n");
}
console.log(probe());

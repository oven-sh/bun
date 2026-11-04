// the error of a store into a dead zone says what the error of a read says: the name of the binding
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
function each() {
  const all = [];
  for (const text of ["late = 2", "[late] = [2]", "({ late } = { late: 2 })", "late += 2", "late++", "(() => { late = 2; })()", "eval('late = 2')", "late"]) all.push(text + " => " + attempt(() => eval(text)));
  const late = 1;
  return all.join("\n") + "\n" + late;
}
console.log(each());

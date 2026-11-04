// evaluated text stores into a constant that is not yet initialized, in sloppy code
function probe() {
  let seen;
  try { eval("late = 2"); seen = "stored"; } catch (error) { seen = error.constructor.name; }
  const late = 1;
  return seen + " " + late;
}
console.log(probe());

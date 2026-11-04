// evaluated text stores into a constant with a written type that is not yet initialized
function probe(): string {
  let seen: string;
  try { eval("late = 2"); seen = "stored"; } catch (error) { seen = (error as Error).constructor.name; }
  const late: number = 1;
  return seen + " " + late;
}
console.log(probe());

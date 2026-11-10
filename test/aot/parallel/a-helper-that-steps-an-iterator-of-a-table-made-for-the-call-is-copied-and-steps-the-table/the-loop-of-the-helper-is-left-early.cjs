function until(steps, limit) {
  let sum = 0;
  for (const step of steps) { if (step > limit) break; sum += step; }
  return sum;
}
function finds(steps, wanted) {
  for (const step of steps) if (step === wanted) return "found " + step;
  return "missing " + wanted;
}
function throwsAt(steps, bad) {
  const seen = [];
  try {
    for (const step of steps) { if (step === bad) throw new Error("bad " + step); seen.push(step); }
  } catch (error) { seen.push(error.message); }
  return seen.join();
}
function skips(steps) {
  const seen = [];
  for (const step of steps) { if (step % 2) continue; seen.push(step); }
  return seen.join();
}
function run(turns) {
  const said = [];
  for (let turn = 0; turn < turns; turn++) {
    const table = new Map([["a", 1 + turn], ["b", 2 + turn], ["c", 3 + turn], ["d", 4 + turn]]);
    said.push(until(table.values(), 3), finds(table.keys(), "c"), finds(table.keys(), "q"), throwsAt(table.values(), 3), skips(table.values()), until(new Set([turn, 9, 1]).values(), 5));
  }
  return said.join("\n");
}
globalThis.kept = [until, finds, throwsAt, skips];
console.log(run(3));

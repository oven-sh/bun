// A function of the program and a function made by new Function() call each other in tail position 100,000 times, and the last one throws.
// The exception is caught by the caller of the first, which is a function of the program or code made at run time, and whose locals are as they were. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function back(n, sum, where) {
  if (n <= 0 && where === "program") throw new RangeError("program " + sum);
  return made(n - 1, sum + 1, where);
}
globalThis.back = back;
const made = new Function("n", "sum", "where", '"use strict"; if (n <= 0 && where === "made") throw new TypeError("made " + sum); return back(n, sum, where);' + never);
function catchInProgram(start, where) {
  const kept = [1, 2, 3];
  try {
    return start(100000, 0, where);
  } catch (error) {
    return error.name + ": " + error.message + " " + kept.join();
  } finally {
    kept.push(4);
  }
}
const catchInMade = new Function(
  "start", "where",
  '"use strict"; const kept = [1, 2]; try { return start(100000, 0, where); } catch (error) { return error.name + ": " + error.message + " " + kept.join(); }' + never,
);
for (const where of ["program", "made"]) {
  for (const start of [back, made]) {
    console.log(catchInProgram(start, where));
    console.log(catchInMade(start, where));
  }
}

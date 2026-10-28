// One class and one function, each written twice: as what a CommonJS file assigns to module.exports, and as the default export of a module. Both are imported by default.
import AssignedCounter from "./assigned-counter.cjs";
import assignedTwice from "./assigned-twice.cjs";
import ExportedCounter from "./exported-counter.mjs";
import exportedTwice from "./exported-twice.mjs";
function withExported(turns) {
  const counter = new ExportedCounter();
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + counter.add(i) + exportedTwice(i)) | 0;
  return sum;
}
function withAssigned(turns) {
  const counter = new AssignedCounter();
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + counter.add(i) + assignedTwice(i)) | 0;
  return sum;
}
const [loop = "out of a CommonJS file", turns = "5000"] = process.argv.slice(2);
console.log(withExported(5000), withAssigned(5000), (loop === "out of a CommonJS file" ? withAssigned : withExported)(Number(turns)));

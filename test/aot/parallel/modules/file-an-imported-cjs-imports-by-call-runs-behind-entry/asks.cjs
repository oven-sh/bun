let jobs = 0;
const count = () => {
  if (++jobs < 40) Promise.resolve().then(count);
};
Promise.resolve().then(count);
globalThis.jobsRun = () => jobs;
import("./late.cjs").then(late => console.log("late is loaded:", late.default.name, "after", jobs, "jobs"));
console.log("asks");
exports.name = "asks";

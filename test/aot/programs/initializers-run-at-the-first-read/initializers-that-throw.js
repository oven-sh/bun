// An initializer that throws stops the module where it stands.
const log = [];
process.on("uncaughtException", (error) => {
  log.push("uncaught " + error.constructor.name);
});
setTimeout(() => {
  for (const read of [() => before.x, () => after.x, () => typeof after, () => AfterClass.name, () => afterFunction()]) {
    try { log.push(String(read())); } catch (error) { log.push(error.constructor.name); }
  }
  console.log(log.join(" | "));
}, 1);
const before = { x: 1 };
const nothing = null;
const bad = { v: nothing.x };
const after = { x: 2 };
class AfterClass {}
function afterFunction() { return after.x; }

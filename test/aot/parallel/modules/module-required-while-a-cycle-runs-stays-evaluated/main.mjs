// A cycle of three runs under a require(). The body of one member calls a function that requires a fourth module, which imports a member that has not begun: that member and the fourth module are evaluated by that require(), for good. The module that was entered first throws behind it: a later require() of either returns.
// COUNT: operation:operationAOTFinishCycleMemberEvaluation = 2
import "./lazy.mjs";
try {
  require("./first.mjs");
  console.log("require of first returns");
} catch (error) {
  console.log("require of first threw:", error.message);
}
for (const [name, load] of [
  ["member", () => require("./member.mjs")],
  ["required", () => require("./required.mjs")],
  ["calls", () => require("./calls.mjs")],
]) {
  try {
    load();
    console.log(`later require of ${name} returns`);
  } catch (error) {
    console.log(`later require of ${name} threw:`, error.message);
  }
}
console.log("main ends");

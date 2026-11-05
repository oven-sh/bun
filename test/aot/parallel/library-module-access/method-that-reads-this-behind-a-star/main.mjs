// process.on reads its receiver, which here is the namespace object of a file that passes on all of node:process.
import * as all from "./again.mjs";
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.name;
  }
}
console.log(
  attempt(() => typeof all.cwd()),
  attempt(() => all.on("x", () => {}) === undefined),
  attempt(() => all.emit("x")),
);

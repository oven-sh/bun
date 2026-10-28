// The file that is required exports a constant. Where the stack ends the require throws, and the `finally` and the `catch` around it run.
let kept;
let reached = 0;
let busy = 0;
let entered = 0;
let left = 0;
let stayedBusy = 0;
let passedBy = 0;

const guarded = () => {
  busy = 1;
  try {
    kept = require("./leaf.mjs");
  } finally {
    busy = 0;
  }
  return 0;
};
const caught = () => {
  entered = 1;
  try {
    kept = require("./other-leaf.mjs");
  } catch {}
  left = 1;
  return 0;
};
function descendToFinally(depth, last) {
  reached++;
  return depth > 0 ? descendToFinally(depth - 1, last) + 1 : last();
}
function descendToCatch(depth, last) {
  reached++;
  return depth > 0 ? descendToCatch(depth - 1, last) + 1 : last();
}

let limit = 0;
let goal = 1e9;
for (let turn = 0; turn <= 200; turn++) {
  reached = busy = 0;
  try {
    descendToFinally(goal, guarded);
  } catch {
    if (busy) stayedBusy++;
  }
  if (turn === 0) limit = reached;
  goal = limit + 20 - turn;
}
goal = 1e9;
for (let turn = 0; turn <= 200; turn++) {
  reached = entered = left = 0;
  try {
    descendToCatch(goal, caught);
  } catch {
    if (entered && !left) passedBy++;
  }
  if (turn === 0) limit = reached;
  goal = limit + 20 - turn;
}
console.log("a finally did not run:", stayedBusy, "a catch was passed by:", passedBy);

// The timeout of a node:vm run stops an endless compiled loop that the run's text called: in a leaf function, in a function with a frame, and in a loop that ends for another argument. The same loop is not interrupted in the next run or outside a run.
const vm = require("vm");

function spinInLeaf() {
  for (;;) {}
}

function sum(depth) {
  return depth === 0 ? 0 : depth + sum(depth - 1);
}

function spinWithFrame(depth) {
  console.log("spinning after " + sum(depth));
  for (;;) {}
}

function countTo(limit) {
  let count = 0;
  while (count !== limit) count++;
  return count;
}

const context = vm.createContext({ spinInLeaf, spinWithFrame, countTo });
const limit = JSON.parse("20000000");

function run(text, timeout) {
  try {
    return vm.runInContext(text, context, { timeout });
  } catch (error) {
    return error.code;
  }
}

console.log("leaf: " + run("spinInLeaf()", 50));
console.log("outside a run: " + countTo(limit));
console.log("framed: " + run("spinWithFrame(4)", 50));
console.log("outside a run: " + countTo(limit));
console.log("no end: " + run("countTo(-1)", 50));
console.log("next run: " + run("countTo(" + limit + ")", 60000));
console.log("outside a run: " + countTo(limit));
console.log("no end again: " + run("countTo(-1)", 50));
console.log("next run: " + run("countTo(" + limit + ")", 60000));

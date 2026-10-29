// A function sets a mark, takes it away and then calls a built-in. Where the stack ends the call throws a RangeError, and whoever catches it finds no mark.
const isOn = process.argv.length > 0;
const list = [3, 1, 2];
const holder = { mark: 0 };
let mark = 0;
let kept;
let reached = 0;
let found = 0;

function clones() {
  mark = 1;
  if (!isOn) return 1;
  mark = 0;
  kept = structuredClone(list);
  return 0;
}
function writes() {
  holder.mark = 1;
  if (!isOn) return 1;
  holder.mark = 0;
  kept = JSON.stringify(list);
  return 0;
}
function descend(depth, last) {
  reached++;
  return depth > 0 ? descend(depth - 1, last) + 1 : last();
}
function descendToWrite(depth) {
  reached++;
  return depth > 0 ? descendToWrite(depth - 1) + 1 : writes();
}

for (const run of [depth => descend(depth, clones), descendToWrite]) {
  let limit = 0;
  let goal = 1e9;
  for (let turn = 0; turn <= 200; turn++) {
    reached = 0;
    try {
      run(goal);
    } catch (error) {
      if (mark || holder.mark) found++;
      mark = holder.mark = 0;
    }
    if (turn === 0) limit = reached;
    goal = limit + 20 - turn;
  }
}
console.log("found the mark:", found);

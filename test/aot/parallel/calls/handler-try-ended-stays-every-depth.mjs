// A function calls another in a `try` whose handler goes on, and behind the `try` it makes an object by a constructor of the engine.
// It runs at every depth close to the end of the stack. The handler runs once at most for each run of the function.
let reached = 0;
let turn = 0;
let probed = 0;
let kept;
const handled = [0, 0, 0];
function probe(more) {
  probed++;
  return more > 0 ? probe(more - 1) + 1 : probed;
}
function countHandler(which) {
  if (++handled[which] > 1000) {
    console.log("a handler runs again and again:", which);
    process.exit(1);
  }
}
const makers = [
  () => {
    try {
      probe(turn & 3);
    } catch {
      countHandler(0);
    }
    kept = new Number(turn);
    return 0;
  },
  () => {
    try {
      probe(turn & 3);
    } catch {
      countHandler(1);
    }
    kept = new Boolean(turn);
    return 0;
  },
  () => {
    try {
      probe(turn & 3);
    } catch {
      countHandler(2);
    }
    kept = new Date(2020, 1, 2, 3, 4, 5, turn);
    return 0;
  },
];
function descendToNumber(depth) {
  reached++;
  return depth > 0 ? descendToNumber(depth - 1) + 1 : makers[0]();
}
function descendToBoolean(depth) {
  reached++;
  return depth > 0 ? descendToBoolean(depth - 1) + 1 : makers[1]();
}
function descendToDate(depth) {
  reached++;
  return depth > 0 ? descendToDate(depth - 1) + 1 : makers[2]();
}
for (const descend of [descendToNumber, descendToBoolean, descendToDate]) {
  let limit = 0;
  let goal = 1e9;
  for (turn = 0; turn <= 300; turn++) {
    reached = 0;
    try {
      descend(goal);
    } catch {}
    if (turn === 0) limit = reached;
    goal = limit + 20 - turn;
  }
  console.log(descend.name, "ended in order:", Object.prototype.toString.call(kept));
}

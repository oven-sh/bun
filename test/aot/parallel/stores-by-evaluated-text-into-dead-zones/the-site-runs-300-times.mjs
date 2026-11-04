// one site evaluates the same text 300 times, each time in the dead zone of a new constant, then behind it
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function count() {
  const early = {}, behind = {};
  let sum = 0;
  for (let turn = 0; turn < 300; turn++) {
    const first = attempt(() => eval("late = 2"));
    const late = turn;
    const second = attempt(() => eval("late = 2"));
    early[first] = (early[first] || 0) + 1;
    behind[second] = (behind[second] || 0) + 1;
    sum += late;
  }
  return JSON.stringify(early) + " " + JSON.stringify(behind) + " " + sum;
}
console.log(count());

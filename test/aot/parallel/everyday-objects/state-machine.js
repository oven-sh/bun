// A table of functions by state and event, with a history
const machine = {
  idle: { start: n => ["running", n], stop: () => ["idle", 0] },
  running: { tick: n => [n > 2 ? "done" : "running", n + 1], stop: n => ["idle", n] },
  done: {},
};
function drive(events, n) {
  let state = "idle";
  const history = [];
  for (const event of events) {
    const change = machine[state]?.[event];
    if (!change) {
      history.push("!" + event);
      continue;
    }
    [state, n] = change(n);
    history.push(state[0] + n);
  }
  return history.join(" ") + " " + state;
}
console.log(drive(["start", "tick", "tick", "stop"], 1));
console.log(drive(["tick", "start", "tick", "start"], 3));
console.log(drive([], 0));

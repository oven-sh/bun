const TRANSITIONS = { idle: { start: "running" }, running: { pause: "paused", stop: "idle" }, paused: { resume: "running", stop: "idle" } };
const EVENTS = ["start", "pause", "bogus", "resume", "stop"];
let state = "idle";
const trail = [state];
for (const e of EVENTS) {
  state = TRANSITIONS[state][e] ?? state;
  trail.push(state);
}
console.log(trail.join(" > "));

const table = {
  idle: { start: "running" },
  running: { pause: "paused", stop: "idle" },
  paused: { start: "running", stop: "idle" },
};
function walked(events) {
  let state = "idle";
  for (const event of events) state = table[state][event] ?? state;
  return state;
}
console.log(walked(JSON.parse('["start","pause","stop","stop","start"]')));

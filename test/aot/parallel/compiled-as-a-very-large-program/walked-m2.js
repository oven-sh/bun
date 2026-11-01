// Flags: --aot-heat=ReadOffStructure
// The name that a walk hands out is kept in a member, and the name is an index or reads like a number, true, null or undefined. walked-key.js says what went wrong.
const DAYS = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
function makePick() { return { day: "", calls: 0, total: 0, largest: 0, smallest: 0, odd: 0, even: 0 }; }
function pick(state, name, weight) {
  state.calls += 1; state.total += weight; if (state.total > 100) state.total -= 100;
  if (weight > state.largest) state.largest = weight; if (weight < state.smallest || state.calls === 1) state.smallest = weight;
  if (weight % 2 === 1) state.odd += 1; else state.even += 1; if (state.odd > state.even + 10) state.odd = state.even;
  if (state.largest - state.smallest > 50) state.largest = state.smallest + 50;
  for (const d in DAYS) { if (DAYS[d] === name) state.day = d; }
  return state.calls; }
function dayOf(state) { return state.day; }
const st = makePick();
pick(st, "Wed", 1); console.log("R=" + dayOf(st));
pick(st, "Sat", 2); console.log("R=" + dayOf(st));

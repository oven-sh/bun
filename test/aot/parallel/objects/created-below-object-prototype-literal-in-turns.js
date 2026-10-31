// One place hands Object.create() Object.prototype and a literal with a method and a getter in turns, two hundred times. Each object has the members of what it was made below, and only the
// first object below each of the two asks the run time.
// COUNT: operation:operationAOTSetLiteralPrototype <= 3
const members = {
  m() { return "members.m"; },
  get size() { return this.items; },
};
function make(proto, items) {
  const made = Object.create(proto); // not a tail call
  made.items = items;
  return made;
}
function call(made) { try { return made.m(); } catch (e) { return e.constructor.name; } }
function size(made) { return made.size; }

const kept = [];
const seen = new Map();
for (let turn = 0; turn < 200; turn++) {
  const made = make(turn % 2 ? members : Object.prototype, turn);
  kept.push(made);
  const below = Object.getPrototypeOf(made) === members ? "below members:" : "below Object.prototype:";
  const answer = below + " " + call(made) + " " + (size(made) === turn ? "its items" : size(made));
  seen.set(answer, (seen.get(answer) ?? 0) + 1);
}
for (const [answer, times] of seen) console.log(answer, times);
let called = 0;
let sum = 0;
for (const made of kept) {
  if (call(made) === "members.m") called++;
  sum += size(made) ?? 0;
}
console.log(called, sum);

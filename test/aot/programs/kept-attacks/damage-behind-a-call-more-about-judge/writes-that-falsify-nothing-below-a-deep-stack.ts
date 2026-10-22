// A WITNESS OF COST, not of a wrong answer: the output is that of plain Bun either way. Read the counters WalksToSendReturnsToLandings, StackWordsLookedAt and ReturnsSentToLandings behind it.
// Below 200 frames of typed code the program does, 20,000 times each, what changes an object and makes no proof false that typed code keeps across a call:
//   deletes an OPTIONAL field that lies in its slot (no mark is set, no field leaves its slot);
//   stores a string into a number field of an object whose cell has the mark already, and of which another field has left its slot already;
//   adds a property that the layout does not know to an object that has such properties already;
//   gives a NEW ordinary object its prototype with Object.setPrototypeOf (nobody has seen the object).
// Each walk looks at every word of the stack and sends 200 returns to their landings, and every one of those frames then makes its tests again.
// The event is the write of the bit that a test reads. The first three flip no such bit and should count no walk. The fourth walks as the code lies (JSObject::setPrototypeDirect cannot tell a new object).
type Entry = { id: number; note?: string; weight?: number; size?: number };

function make(id: number): Entry {
  return { id };
}

const worn: Entry = make(-1);
worn.weight = 1;
worn.size = 2;
(worn as any).weight = "left its slot";
(worn as any).first = 0;

const base = { tag: "base" };
let kept = 0;

function work(entry: Entry, round: number): number {
  entry.note = "n" + (round & 7);
  delete entry.note;
  (worn as any).size = round & 1 ? "text" : round;
  (worn as any)["extra" + (round & 15)] = round;
  const fresh = Object.setPrototypeOf({ round }, base) as { round: number; tag: string };
  kept += fresh.tag.length;
  return entry.id + fresh.round;
}

function descend(entry: Entry, depth: number, round: number): number {
  const before = entry.id;
  const below = depth > 0 ? descend(entry, depth - 1, round) : work(entry, round);
  return below + entry.id - before;
}

let total = 0;
const entry = make(7);
for (let round = 0; round < 20000; round++) total = (total + descend(entry, 200, round)) | 0;
console.log(total + " " + kept + " " + Object.keys(worn).length + " " + typeof worn.size + " " + ("note" in entry));

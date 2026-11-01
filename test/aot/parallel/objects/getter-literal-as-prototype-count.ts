// COUNT: arrivals <= 40
interface Part {
  value: number;
}
interface Session {
  readonly current: Part | null;
  lead: number;
  width: number;
  depth: number;
}
function make(value: number): Session {
  const held: { part: Part | null } = { part: { value } };
  const made: Session = {
    get current() {
      return held.part;
    },
    lead: 1,
    width: 2,
    depth: 3,
  };
  return made;
}
const above = make(5);
const heir = Object.create(above) as Session;
heir.lead = 7;

const all = [make(1), above, make(3)];
const turns = Number(process.env.TURNS ?? 3000);
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
  const one = all[turn % 3]!;
  const part = one.current;
  sum += (part === null ? 0 : part.value) + one.lead + one.width + one.depth;
}
// Nothing reads `current` through the heir.
console.log(sum, heir.width, heir.lead, above.lead);

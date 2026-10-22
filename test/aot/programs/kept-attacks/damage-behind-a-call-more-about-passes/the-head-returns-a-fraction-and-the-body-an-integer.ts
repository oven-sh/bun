// `weigh` begins with a short way out that only reads and tests, and goes on with a long body. In the hot loop of `holder` the short way is copied in front of the call (InlineHeads),
// behind the pass that has given the call its landing and has taken the tests behind it away. From then on three things arrive where the call used to come back:
// what the copy of the head returns (a fraction read from a slot), what the call returns at its return address (an integer), and what it returns at its landing.
// The result is used behind the place where they meet, so the landing block gets a parameter for it and the landing edge passes an argument, in another representation than the head's.
// The damage is done in the long body only. The reads of `p` behind the call have no test of their own: they are right only if the call of the whole function has kept the landing of the site.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Entry {
  key: number;
  weight: number;
  constructor(key: number, weight: number) {
    this.key = key;
    this.weight = weight;
  }
}

const table = new Map<number, number>();
let strikes = 0;

function weigh(p: Point, entry: Entry): number {
  if (entry.key < 8) return entry.weight;
  let found = table.get(entry.key);
  if (found === undefined) {
    found = 0;
    for (let index = 0; index < 5; index++) found = (found * 31 + entry.key + index) | 0;
    table.set(entry.key, found);
  }
  if (strikes === 1) delete (p as any).x;
  else if (strikes === 2) (p as any).y = "T";
  else if (strikes === 3) Object.defineProperty(p, "x", { get: () => -1, configurable: true });
  else if (strikes === 4) Object.setPrototypeOf(p, { x: "inherited", y: "inherited" });
  return found & 7;
}

function holder(p: Point, entries: Entry[]): string {
  let sum = 0;
  let seen = "";
  for (let index = 0; index < entries.length; index++) {
    const before = p.x + p.y;
    const got = weigh(p, entries[index]);
    sum += got;
    seen += before + ":" + got + ":" + p.x + "," + p.y + " ";
  }
  return sum + " " + seen;
}

const entries: Entry[] = [];
for (let index = 0; index < 12; index++) entries.push(new Entry(index + 2, index + 0.5));

for (let round = 0; round < 400; round++) {
  strikes = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1), entries);
  if (strikes || round === 0) console.log(round + ": " + line);
}

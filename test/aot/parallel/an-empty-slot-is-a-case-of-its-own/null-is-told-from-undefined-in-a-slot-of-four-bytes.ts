const enum Level { Low = 1, High = 2 }
interface Kind { flags: number; level: Level }
const Kind = function (this: Kind, flags: number) { this.flags = flags; } as unknown as { new (flags: number): Kind };
const unseen = (x: any) => [x][JSON.parse("0")];
function use(kind: Kind): string {
  const level = kind.level;
  if (level == null) return level === null ? "null" : "none";
  return "has " + (level & 3) + " of " + kind.flags;
}
const asked: (kind: Kind) => string = unseen(use);
const bare = new Kind(4);
const full = new Kind(4);
full.level = Level.High;
const nulled = new Kind(4);
(nulled as any).level = JSON.parse("null");
let first = "", last = "";
for (let turn = 0; turn < 300; turn++) {
  last = asked(bare) + " | " + asked(full) + " | " + asked(nulled);
  if (!turn) first = last;
}
console.log(first);
console.log(last);
console.log(Object.hasOwn(nulled, "level"));
export {};

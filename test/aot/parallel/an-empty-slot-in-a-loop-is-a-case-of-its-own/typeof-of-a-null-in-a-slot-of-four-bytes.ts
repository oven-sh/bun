const enum Level { Low = 1, High = 2 }
interface Kind { flags: number; level: Level }
type Whole = Kind;
const Kind = function (this: Kind, flags: number) { this.flags = flags; } as unknown as { new (flags: number): Kind };
const unseen = (x: any) => [x][JSON.parse("0")];
function use(kind: Kind): string { if (typeof (kind as Whole).level === "undefined") return "undefined"; return "has " + typeof (kind as Whole).level; }
const asked: (kind: Kind) => string = unseen(use);
const full = new Kind(4);
(full as Whole).level = Level.High;
const odd = new Kind(4);
(odd as any).level = JSON.parse("null");
let first = "", last = "";
for (let turn = 0; turn < 300; turn++) { last = asked(odd) + " | " + asked(full); if (!turn) first = last; }
console.log(first);
console.log(last);
console.log(Object.hasOwn(odd, "level"));
export {};

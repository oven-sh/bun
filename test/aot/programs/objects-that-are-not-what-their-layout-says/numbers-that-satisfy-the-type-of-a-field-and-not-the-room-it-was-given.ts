// Every store here is well typed: a `number` goes into a field declared `number`, and nothing is cast. All the program has ever shown of the fields is small integers,
// so a compiler may have given them four bytes. The numbers below are no small integers: the lowest int32, what lies past int32, fractions, NaN, -0, the infinities.
// Nothing may be refused, rounded or lost, and whoever says that such a field never changes its form has to say it of all numbers.
const lines: string[] = [];
function say(label: string, value: unknown) { lines.push(label + ": " + JSON.stringify(value, (_key, held) => typeof held === "number" && !Number.isFinite(held) ? "#" + held : Object.is(held, -0) ? "#-0" : held)); }

interface Kind { flags: number; id: number; next: Kind | undefined; }
const Kind = function (this: Kind, flags: number, id: number) { this.flags = flags; this.id = id; this.next = undefined; } as unknown as new (flags: number, id: number) => Kind;
class Mark { flags: number; id: number; constructor(flags: number, id: number) { this.flags = flags; this.id = id; } }

function flagsOf(kind: Kind) { return kind.flags; }
function idOf(kind: Kind) { return kind.id; }
function has(kind: Kind, bit: number) { return (kind.flags & bit) !== 0; }
function add(kind: Kind, bits: number) { kind.flags |= bits; }
function setFlags(kind: Kind, flags: number) { kind.flags = flags; }
function setId(kind: Kind, id: number) { kind.id = id; }
function show(kind: Kind) { return [flagsOf(kind), idOf(kind), has(kind, 1), kind.flags + kind.id, typeof kind.flags, Object.keys(kind).join()]; }
function flagsOfMark(mark: Mark) { return mark.flags; }
function setMark(mark: Mark, flags: number) { mark.flags = flags; }
function showMark(mark: Mark) { return [flagsOfMark(mark), mark.id, mark.flags * 2, Object.keys(mark).join()]; }

const warm: Kind[] = [], marks: Mark[] = [];
for (let i = 0; i < 300; i++) { warm.push(new Kind(i & 15, i)); marks.push(new Mark(i & 7, i)); }
let tally = 0;
for (let round = 0; round < 40; round++) for (let i = 0; i < 300; i++) { add(warm[i], round & 3); setId(warm[i], i + round); setMark(marks[i], round & 7); tally += flagsOf(warm[i]) + idOf(warm[i]) + flagsOfMark(marks[i]) + (has(warm[i], 2) ? 1 : 0); }
say("warm", tally);
let serial = 1000;
function fresh() { return new Kind(7, serial++); }

{ const a = fresh(); add(a, 1 << 31); say("bit 31 is added", show(a)); }
{ const a = fresh(); setFlags(a, 1 << 31); say("bit 31 alone", show(a)); }
{ for (let low = -2147483648; low <= -2147483640; low++) { const a = fresh(); setFlags(a, low); setId(a, low); say("the lowest int32 " + low, show(a)); } }
{ const a = fresh(); setFlags(a, 2147483647); setId(a, 2147483647); say("the highest int32", show(a)); setId(a, idOf(a) + 1); say("and one more", show(a)); }
{ const a = fresh(); setFlags(a, 2 ** 31); say("two to the 31st", show(a)); setFlags(a, 2 ** 32 + 1); say("past uint32", show(a)); setFlags(a, 2 ** 53); say("two to the 53rd", show(a)); }
{ const a = fresh(); setFlags(a, -(2 ** 31) - 1); say("below int32", show(a)); }
{ const a = fresh(); setFlags(a, 0.5); setId(a, -1.25); say("fractions", show(a)); }
{ const a = fresh(); setFlags(a, 0 / 0); say("NaN", show(a)); setFlags(a, 1 / 0); say("Infinity", show(a)); setFlags(a, -1 / 0); say("-Infinity", show(a)); }
{ const a = fresh(); setFlags(a, -0); say("-0", [Object.is(flagsOf(a), -0), 1 / flagsOf(a), show(a)]); }
{ const a = fresh(); setFlags(a, 1e308 * 10); setId(a, 5e-324); say("the ends of the doubles", show(a)); }
{ const a = fresh(); setFlags(a, 0.5); setFlags(a, 3); say("a fraction and an integer again", show(a)); add(a, 4); say("and a bit", show(a)); }
{ say("bit 31 into the constructor", show(new Kind(1 << 31, -2147483647))); }
{ say("a fraction into the constructor", show(new Kind(0.5, 2 ** 40))); }
{ say("NaN and -0 into the constructor", show(new Kind(0 / 0, -0))); }
{ const many: Kind[] = []; for (let i = 0; i < 400; i++) many.push(new Kind(i === 399 ? 1 << 31 : i, i === 398 ? 1.5 : i)); say("into a constructor that runs hot", [show(many[397]), show(many[398]), show(many[399])]); }
{ const m = new Mark(1, 2); setMark(m, 1 << 31); say("a class, bit 31", showMark(m)); setMark(m, 0.25); say("a class, a fraction", showMark(m)); setMark(m, 0 / 0); say("a class, NaN", showMark(m)); }
{ say("a class, into the constructor", [showMark(new Mark(1 << 31, 0.5)), showMark(new Mark(-2147483646, 2 ** 31))]); }
{ const a = fresh(); a.id++; a.flags <<= 28; say("shifted to the top", show(a)); a.flags <<= 3; say("and into bit 31", show(a)); a.flags >>>= 0; say("and read as unsigned", show(a)); }
{ const a = fresh(); a.flags **= 40; say("raised", show(a)); a.flags /= 3; say("divided", show(a)); a.flags %= 1; say("the remainder", show(a)); }
{ const a = fresh(); for (let i = 0; i < 40; i++) setId(a, idOf(a) * 2); say("doubled forty times", show(a)); }
{ const a = fresh(), b = fresh(); setFlags(b, 1 << 31); setId(b, 0.5); Object.assign(a, b); say("assigned from its own kind", show(a)); const c = { ...b }; say("spread", [c.flags, c.id]); }

let after = 0;
for (let i = 0; i < 300; i++) after += flagsOf(warm[i]) + idOf(warm[i]) + flagsOfMark(marks[i]);
say("the others are as they were", after);
console.log(lines.join("\n"));

const enum Bits { None = 0, One = 1, Two = 2, Four = 4, Eight = 8, ThirtyTwo = 32 }
class Kind { flags: Bits; objectFlags: Bits; symbol: string; next: Kind | undefined; constructor(flags: Bits, objectFlags: Bits, symbol: string) { this.flags = flags; this.objectFlags = objectFlags; this.symbol = symbol; this.next = undefined; } }
function odd(text: string): any { return JSON.parse(text); }
function extent(kind: Kind): number { return +kind.flags - kind.objectFlags; }
const kept: (() => number)[] = [];
function run(kind: any): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const size = extent(kind);
  const read = () => size * 2;
  if (size & Bits.ThirtyTwo) work = (work + 1) | 0;
  kept.push(read);
  return work;
}
const made: any = JSON.parse("true") ? new Kind(Bits.Eight | Bits.ThirtyTwo, Bits.Four, "k") : odd('{"flags":1,"objectFlags":2}');
console.log(run(made), kept[0]());

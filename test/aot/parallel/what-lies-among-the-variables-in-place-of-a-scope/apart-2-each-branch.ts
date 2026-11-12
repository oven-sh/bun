const enum Bits { None = 0, One = 1, Two = 2, Four = 4, Eight = 8, ThirtyTwo = 32 }
class Kind { flags: Bits; objectFlags: Bits; symbol: string; next: Kind | undefined; constructor(flags: Bits, objectFlags: Bits, symbol: string) { this.flags = flags; this.objectFlags = objectFlags; this.symbol = symbol; this.next = undefined; } }
function odd(text: string): any { return JSON.parse(text); }
function extent(kind: Kind): number { return +kind.flags - kind.objectFlags; }
const kept: (() => number)[] = [];
function low(kind: any): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const size = extent(kind);
  if (size & Bits.ThirtyTwo) kept.push(() => size * 2);
  else kept.push(() => size + 100);
  kept.push(() => size);
  return work;
}
function high(kind: any): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const size = extent(kind);
  if (size & Bits.ThirtyTwo) kept.push(() => size * 2);
  else kept.push(() => size + 100);
  kept.push(() => size);
  return work;
}
const flag = JSON.parse("true");
const small: any = flag ? new Kind(Bits.Four | Bits.One, Bits.One, "k") : odd('{"flags":1,"objectFlags":2}');
const large: any = flag ? new Kind(Bits.Eight | Bits.ThirtyTwo, Bits.Four, "k") : odd('{"flags":1,"objectFlags":2}');
console.log(low(small), high(large), kept.map((read) => read()).join());

// Every statement that stores under these names is in sight and stores whole numbers of 32 bits, all of them. A slot of four bytes keeps a few of those for its marks, so these slots have eight. Two classes have the names, so nothing tells a read which one comes, and it asks first for an answer of that form.
let reads = 0;
enum Kind { None = 0, One = 1, Two = 2, Many = 1000 }
class Meter {
  steps: Kind = Kind.None; turns: Kind = Kind.None; laps: Kind = Kind.None; paces: Kind = Kind.None;
  ratio: number = 0.5;
  on: boolean = false; off: boolean = false;
  next: Meter | null = null; back: Meter | null = null; up: Meter | null = null; down: Meter | null = null; last: Meter | null = null;
}
class Gauge {
  last: Gauge | null = null; down: Gauge | null = null; up: Gauge | null = null; back: Gauge | null = null; next: Gauge | null = null;
  off: boolean = false; on: boolean = false;
  ratio: number = 0.5;
  hops: Kind = Kind.None; laps: Kind = Kind.None; turns: Kind = Kind.None; steps: Kind = Kind.None;
  more: Kind = Kind.None;
}
// More classes hold this name as a whole value than in a narrow slot, so a read under it asks as at every place.
class Bag { paces: any = "of a bag"; }
class Sack { other: any = 0; paces: any = "of a sack"; }
function makeMeter(i: number) {
  const meter = new Meter();
  meter.steps = (i | 0) as Kind; meter.turns = ((i * 3) | 0) as Kind; meter.paces = ((i * 7) | 0) as Kind;
  return meter;
}
function makeGauge(i: number) {
  const gauge = new Gauge();
  gauge.steps = (-i | 0) as Kind; gauge.turns = ((i * 5) | 0) as Kind;
  return gauge;
}
// Objects of the two classes never meet in one variable.
const meters = new Map<number, Meter>();
const gauges = new Map<number, Gauge>();
function hideMeter(o: Meter): any { meters.set(1, o); return meters.get(1); }
function hideGauge(o: Gauge): any { gauges.set(1, o); return gauges.get(1); }
const bags = new Map<number, Bag>();
const sacks = new Map<number, Sack>();
function hideBag(o: Bag): any { bags.set(1, o); return bags.get(1); }
function hideSack(o: Sack): any { sacks.set(1, o); return sacks.get(1); }
function pacesOf(o: any) { const v = o.paces; reads++; return v; }
function stepsOf(o: any) { const v = o.steps; reads++; return v; }
function turnsOf(o: any) { const v = o.turns; reads++; return v; }
function stepsOfEither(o: any) { const v = o.steps; reads++; return v; }
function turnsOfEither(o: any) { const v = o.turns; reads++; return v; }
let sum = 0;
for (let i = 0; i < 700; i++) {
  const o = hideMeter(makeMeter(i));
  sum += stepsOf(o) + turnsOf(o) + pacesOf(o);
}
for (let i = 0; i < 1400; i++) {
  const o = i % 2 ? hideMeter(makeMeter(i)) : hideGauge(makeGauge(i));
  sum += stepsOfEither(o) + turnsOfEither(o);
}
let ends = "";
for (let i = 0; i < 4; i++) {
  const o = hideMeter(makeMeter(i === 0 ? 2147483647 : i === 1 ? -2147483648 : i === 2 ? -2147483645 : -1));
  ends += stepsOf(o) + " " + turnsOf(o) + " " + pacesOf(o) + " " + typeof stepsOf(o) + " | ";
}
const gauge = hideGauge(makeGauge(5));
console.log(sum, reads, ends, stepsOf(gauge), turnsOf(gauge), stepsOf(hideMeter(makeMeter(9))), pacesOf(hideBag(new Bag())), pacesOf(hideSack(new Sack())), pacesOf(hideMeter(makeMeter(9))));

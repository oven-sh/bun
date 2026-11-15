class Meter {
  reading: number;
  unit: string;
  constructor(reading: number, unit: string) {
    this.reading = reading;
    this.unit = unit;
  }
}
class Dial {
  unit: string;
  reading: number;
  face: string;
  constructor(reading: number) {
    this.unit = "turns";
    this.reading = reading;
    this.face = "round";
  }
}
class Pipe {
  meter: Meter | undefined;
  name: string;
  constructor(name: string, meter: Meter | undefined) {
    this.name = name;
    this.meter = meter;
  }
}
const meters: unknown[] = [new Meter(1, "m"), new Dial(2), { reading: 3 }, new Meter(4, "m"), { get reading() { return 5; } }, Object.create(new Meter(6, "m")), new Meter(7, "m")];
const pipes: Pipe[] = meters.map((meter, place) => new Pipe("pipe " + place, meter as Meter));
class Visit {
  next: Visit | null;
  constructor(next: Visit | null) {
    this.next = next;
  }
}
let visits: Visit | null = null;
function numberOfVisits(): number {
  let count = 0;
  for (let visit = visits; visit; visit = visit.next) count++;
  return count;
}
function readingIn(pipe: Pipe): number {
  visits = new Visit(visits);
  return pipe.meter!.reading;
}
function report(list: Pipe[]): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += readingIn(list[i]);
  return total;
}
function reportOne(pipe: Pipe): number {
  return readingIn(pipe) + 100;
}
(globalThis as any).reports = [report, reportOne];
console.log((globalThis as any).reports[0](pipes), numberOfVisits());
for (const pipe of pipes) console.log((globalThis as any).reports[1](pipe), numberOfVisits());

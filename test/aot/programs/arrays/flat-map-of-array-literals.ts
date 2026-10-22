// `list.flatMap(x => [..])`: where the callback cannot be observed and every result is an array literal written in it, the literals are never made: their elements go straight into the result, or are only counted.
// IR= 0 howManyParts NewArray
// IR= 1 bothEnds NewArray(Like|WithCapacity)
// IR= 1 bothEnds = NewArray - \(
// IR= 1 afterOtherLinks NewArray(Like|WithCapacity)
// IR= 1 afterOtherLinks = NewArray - \(
// IR= 1 withWhatItCaptures NewArray(Like|WithCapacity)
// IR= 1 withWhatItCaptures = NewArray - \(
// IR= 0 nothingEver NewArray
interface Parcel {
  weight: number;
  stops: number;
  label: string;
}
function howManyParts(parcels: Parcel[]): number {
  let total = 0;
  for (let round = 0; round < 3; round++) total += parcels.flatMap(p => (p.stops > round ? [p.weight, p.stops, 0] : p.stops === round ? [p.weight] : [])).length;
  return total;
}
function bothEnds(parcels: Parcel[]): (number | string)[] {
  let last: (number | string)[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap(p => [p.label, p.weight + round]);
  return last;
}
function afterOtherLinks(parcels: Parcel[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) {
    last = parcels
      .slice(1, 5)
      .filter(p => p.weight > 2)
      .map(p => ({ half: p.weight / 2, stops: p.stops + round }))
      .flatMap(h => (h.stops > 1 ? [h.half, h.stops] : []));
  }
  return last;
}
function withWhatItCaptures(parcels: Parcel[], extra: number): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap(p => (p.weight > extra ? [p.weight + extra] : [extra, round]));
  return last;
}
function arraysInside(parcels: Parcel[]): unknown[] {
  let last: unknown[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap(p => [[p.weight], [[p.stops + round]]]);
  return last;
}
function ofNumbers(numbers: number[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = numbers.flatMap(n => (n > 1 ? [n, n * 0.5 + round] : [n]));
  return last;
}
function nothingEver(parcels: Parcel[]): number {
  let total = 0;
  for (let round = 0; round < 2; round++) total += parcels.flatMap(() => []).length;
  return total;
}
const shared = [7, 8];
function returnsAnArrayItWasGiven(parcels: Parcel[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap(p => (p.stops ? shared : [p.weight]));
  return last;
}
function returnsNoArray(parcels: Parcel[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap(p => (p.stops ? p.weight : [p.weight, p.weight]));
  return last;
}
function keepsTheLiteral(parcels: Parcel[]): string {
  const kept: number[][] = [];
  let flat: number[] = [];
  for (let round = 0; round < 2; round++) {
    flat = parcels.flatMap(p => {
      const pair = [p.weight, p.stops];
      kept.push(pair);
      return pair;
    });
  }
  return flat.join() + " " + kept.length;
}
function withAHole(parcels: Parcel[]): string {
  let flat: (number | undefined)[] = [];
  // prettier-ignore
  for (let round = 0; round < 2; round++) flat = parcels.flatMap(p => [p.weight, , p.stops]);
  return flat.length + " " + flat.join();
}
function writesDown(parcels: Parcel[], log: string[]): number {
  let total = 0;
  for (let round = 0; round < 2; round++) {
    total += parcels.flatMap(p => {
      log.push(p.label);
      return [p.weight];
    }).length;
  }
  return total;
}
function looksAtTheIndex(parcels: Parcel[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap((p, i) => [p.weight, i]);
  return last;
}
function spreads(parcels: Parcel[]): number[] {
  let last: number[] = [];
  for (let round = 0; round < 2; round++) last = parcels.flatMap(p => [...shared, p.weight]);
  return last;
}
const show = (value: unknown): string => JSON.stringify(value) ?? "undefined";
function attempt(what: string, run: () => unknown): void {
  try {
    console.log(what, show(run()));
  } catch (error) {
    console.log(what, (error as Error).constructor.name);
  }
}
const parcels: Parcel[] = [];
for (let i = 0; i < 7; i++) parcels.push({ weight: i * 1.5, stops: i % 3, label: "p" + i });
console.log(howManyParts(parcels), show(bothEnds(parcels)), show(afterOtherLinks(parcels)), show(withWhatItCaptures(parcels, 4)));
console.log(show(arraysInside(parcels)), show([ofNumbers([1, 2, 3]), ofNumbers([0.5, 2.5]), ofNumbers([]), ofNumbers([NaN, 4])]), nothingEver(parcels));
console.log(show(returnsAnArrayItWasGiven(parcels)), show(returnsNoArray(parcels)), keepsTheLiteral(parcels), withAHole(parcels));
const log: string[] = [];
console.log(writesDown(parcels, log), log.join(), show(looksAtTheIndex(parcels)), show(spreads(parcels)));

const withHoles: Parcel[] = new Array<Parcel>(5);
withHoles[1] = parcels[4]!;
withHoles[3] = parcels[2]!;
console.log(howManyParts(withHoles), show(bothEnds(withHoles)), show(afterOtherLinks(withHoles)));
const withNull: Parcel[] = [parcels[1]!, null as unknown as Parcel, parcels[2]!];
attempt("null, counted", () => howManyParts(withNull));
attempt("null, kept", () => bothEnds(withNull));
class Crate<T> extends Array<T> {}
const crate = new Crate<Parcel>();
for (let i = 0; i < 3; i++) crate.push(parcels[i]!);
const flat = bothEnds(crate);
console.log(flat.length, flat instanceof Crate, Array.isArray(flat), howManyParts(crate));
console.log(howManyParts([]), show(bothEnds([])), show(afterOtherLinks([])), bothEnds(Object.freeze(parcels.slice(0, 4)) as Parcel[]).length);
const many: Parcel[] = [];
for (let i = 0; i < 3000; i++) many.push({ weight: i, stops: i % 4, label: "m" });
const long = withWhatItCaptures(many, 1500);
console.log(howManyParts(many), long.length, long[0], long[long.length - 1], bothEnds(many).length);

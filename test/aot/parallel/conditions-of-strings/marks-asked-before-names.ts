// A comparison of two strings and a field that most objects lack: the field is asked first where that changes nothing. A getter, a prototype, a deleted field, a frozen object and a proxy are asked in order.
interface Parcel { weight: number; label?: string; above?: Parcel; stamp?: Parcel; moves: number; shelf?: number; note?: string }
function ParcelMaker(this: Parcel, label: string | undefined, weight: number) { this.moves = 0; this.label = label; this.stamp = undefined; this.weight = weight; this.above = undefined; }
const Parcel = ParcelMaker as unknown as { new (label: string | undefined, weight: number): Parcel; prototype: any };
function packed(label: string | undefined, weight: number): Parcel { const parcel = new Parcel(label, weight); parcel.above = weight % 4 ? undefined : parcel; return parcel; }
function moved(label: string): Parcel { const parcel = new Parcel(label, 0); parcel.moves += 1; return parcel; }
function shelve(parcel: Parcel, shelf: number): void { if (shelf % 10 === 0) parcel.note = "n" + shelf; parcel.shelf = shelf; }
function askAll<T>(depot: Map<string, Parcel>, question: (parcel: Parcel, place: string) => T | undefined): T | undefined {
  let answer: T | undefined;
  for (const [place, parcel] of depot) if ((answer = question(parcel, place))) break;
  return answer || undefined;
}
let asked = 0, log = moved("x").label + " ";
function stampOf(depot: Map<string, Parcel>, wanted: Parcel): Parcel | undefined {
  return askAll(depot, parcel => {
    asked++;
    return parcel.label === wanted.label && parcel.stamp ? parcel.stamp : undefined;
  });
}
function press(parcel: Parcel, stamp: Parcel | undefined): void { if (stamp) parcel.stamp = stamp; }
function weightOfPressed(depot: Map<string, Parcel>, wanted: Parcel, stamp: Parcel | undefined): number {
  return askAll(depot, parcel => {
    const alike = parcel.label === wanted.label;
    press(parcel, stamp);
    return alike && parcel.stamp ? parcel.weight + 1 : undefined;
  }) ?? 0;
}
const world = globalThis as any; world.Parcel = Parcel; world.askAll = askAll; world.stampOf = stampOf; world.press = press; world.weightOfPressed = weightOfPressed;
const depot = new Map<string, Parcel>(), every: Parcel[] = [];
for (let i = 0; i < 360; i++) { const parcel = packed(i % 45 === 44 ? undefined : "label" + (i % 36), i); every.push(parcel); depot.set("place" + i, parcel); }
for (let i = 0; i < every.length; i += 5) shelve(every[i], i);
for (let i = 0; i < every.length; i += 80) every[i].stamp = every[i + 1];
let sum = 0;
function add(value: number): void { sum = (sum * 9 + value) % 1000003; }
function searchFor(wanted: Parcel[]): void { for (const parcel of wanted) { const found = stampOf(depot, parcel); add(found ? found.weight : 5); } }
searchFor(every);
log += sum + " " + asked;
const second = new Map<string, Parcel>(); for (let i = 0; i < 56; i++) second.set("p" + i, packed("s" + (i % 28), i));
for (let i = 0; i < 36; i++) add(world.weightOfPressed(second, packed("s" + i, 1), i === 23 ? every[1] : undefined));
log += " " + sum;
const last = packed("la" + "bel" + String(4), 1001); depot.set("last", last);
const key: string = JSON.parse('["stamp"]')[0], plain = JSON.parse('{"weight":2}'); plain[key] = every[2];
let got = 0; Object.defineProperty(every[5], key, { get() { got++; return undefined; }, configurable: true }); delete (every[6] as any)[key]; Object.freeze(every[7]);
(every[8] as any).extra = 1; Object.setPrototypeOf(every[9], plain); delete (every[9] as any)[key];
depot.set("proxy", new Proxy(every[10], { get(target: any, name: any) { log += " " + String(name); return target[name]; } }));
sum = 0; asked = 0;
searchFor([every[4], every[5], every[6], every[7], every[8], every[9], every[44], last]);
(Parcel.prototype as any)[key] = every[1];
searchFor([every[6], every[9], last]);
console.log(log, sum, asked, got);

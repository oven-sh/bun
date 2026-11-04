// -0 arrives: it is no int32, and 0 is.
let nextId = 1;
class Thing {
  id: number;
  name: string;
  constructor(name: string) { this.id = 0; this.name = name; }
}
function idOf(t: Thing): number { if (!t.id) { t.id = nextId; nextId++; } return t.id; }
function isLater(a: Thing, b: Thing): boolean { return idOf(a) > idOf(b); }
function keyOf(t: Thing): string { return "#" + t.id; }
function half(t: Thing): number { return t.id / 2; }
function hasId(t: Thing): boolean { return t.id !== 0; }
function sum(list: Thing[]): number { let all = 0; for (const t of list) all += t.id; return all; }
function attempt(what: () => unknown): string {
  try {
    const got = what();
    return typeof got + ":" + (Object.is(got, -0) ? "-0" : String(got));
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
const things: Thing[] = [];
for (let i = 0; i < 8; i++) things.push(new Thing("n" + i));
for (let i = 0; i < 6; i++) idOf(things[i]);
const victim: any = things[3];
// Whoever finds them there may do anything to them: nothing is proven of the objects or of who calls the readers.
Object.assign(globalThis, { things, readers: [idOf, isLater, keyOf, half, hasId, sum], Thing, brought: -0 });
// What is brought comes from where nobody sees: neither the text nor Link shows what it is.
const brought: any = (globalThis as any).brought;
function show(label: string) {
  console.log(label, [
    attempt(() => keyOf(victim)), attempt(() => half(victim)), attempt(() => 1 / victim.id), attempt(() => hasId(victim)), attempt(() => sum(things)),
    attempt(() => things.map(t => t.id).join()), attempt(() => idOf(victim)), attempt(() => isLater(victim, things[2])),
  ].join(" | "));
  console.log(label, attempt(() => JSON.stringify(victim)), attempt(() => Object.keys(victim).join()), attempt(() => "id" in victim), attempt(() => Object.hasOwn(victim, "id")));
}
show("before");
console.log(attempt(() => (victim.id = brought)));
show("after");
console.log(attempt(() => (victim.id = 3)));
show("again");
console.log(attempt(() => idOf(things[6])), attempt(() => idOf(things[7])), attempt(() => idOf(new Thing("late"))));

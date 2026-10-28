// Untyped code reads, stores and creates fields of more typed objects than the lookup table has rows for. An access whose structure has no row takes the slow path and still gives the right answer.
// COUNTER: LookupTableIsFull >= 1
// COUNTER: LookupTableIsFull <= 20000
const turns: number = JSON.parse("25");
const box: any[] = JSON.parse("[0]");
function hidden(value: unknown): any { box[0] = value; return box[0]; }
const lines: string[] = [];
function say(what: string, ...values: unknown[]): void { lines.push(what + ": " + values.map(String).join(" ")); }
function digestOf(text: string, seed: number): number {
  let digest = seed;
  for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0;
  return digest;
}

interface Fields { count: number; ratio: number; name: string; active: boolean; note?: string }
class Circle { count: number = 1; ratio: number = 0.5; name: string = "circle"; active: boolean = true; link: Circle | null = null; declare note?: string; }
class Square { count: number = 2; ratio: number = 1.5; name: string = "square"; active: boolean = false; link: Square | null = null; declare note?: string; }
class Triangle { count: number = 3; ratio: number = 2.5; name: string = "triangle"; active: boolean = true; link: Triangle | null = null; declare note?: string; }
class Pentagon { count: number = 4; ratio: number = 3.5; name: string = "pentagon"; active: boolean = false; link: Pentagon | null = null; declare note?: string; }
class Hexagon { count: number = 5; ratio: number = 4.5; name: string = "hexagon"; active: boolean = true; link: Hexagon | null = null; declare note?: string; }
class Octagon { count: number = 6; ratio: number = 5.5; name: string = "octagon"; active: boolean = false; link: Octagon | null = null; declare note?: string; }
const factories: (() => Fields)[] = [() => new Circle(), () => new Square(), () => new Triangle(), () => new Pentagon(), () => new Hexagon(), () => new Octagon()];

function storeByName(o: any, i: number): void {
  o.count = i % 5 ? i : i + 0.5;
  o.ratio = i + 0.25;
  o.name = "n" + i;
  o.active = i % 2 === 0;
  o.link = i % 3 ? o : null;
}
function readByName(o: any): string {
  return o.count + " " + o.ratio + " " + o.name + " " + o.active + " " + (o.link === o) + " " + o.note;
}
function readTyped(o: Fields): string {
  return o.count + " " + o.ratio + " " + o.name + " " + o.active + " " + o.note;
}

const objects = factories.map(create => create());
for (const o of objects) say("created", readByName(hidden(o)), "|", readTyped(o));
let digest = 0;
for (let i = 0; i < turns; i++) {
  for (let k = 0; k < objects.length; k++) {
    const untyped = hidden(objects[k]);
    storeByName(untyped, i * 7 + k);
    digest = digestOf(readByName(untyped) + " | " + readTyped(objects[k]), digest);
  }
}
say("stored and read in turn", digest);
for (const o of objects) say("stored last", readByName(hidden(o)), "|", readTyped(o));

function createNotes(create: () => Fields): string {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    const created = create();
    const untyped = hidden(created);
    seen = untyped.note + " " + ("note" in untyped);
    untyped.note = "note " + i;
    seen += " " + untyped.note + " " + created.note + " " + Object.keys(created).join();
    delete untyped.note;
    seen += " " + untyped.note + " " + created.note + " " + ("note" in untyped);
  }
  return seen;
}
for (const create of factories) say("optional field created and deleted", createNotes(create));

function readNotes(o: any): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) answers.add(String(o.note));
  return [...answers].join("|");
}
for (const create of factories) {
  const created = create();
  const untyped = hidden(created);
  const prototype = hidden(Object.getPrototypeOf(created));
  const absent = readNotes(untyped);
  prototype.note = "inherited";
  const inherited = readNotes(untyped) + " " + created.note;
  delete prototype.note;
  say("optional field below a prototype property", absent, inherited, readNotes(untyped), created.note);
}

console.log(lines.join("\n"));
export {};

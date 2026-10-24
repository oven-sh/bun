// The .json lowers the limit of string literal types to two, so nearly every literal here has no word of its own: it is an ordinary string, and a test for it compares texts.
// Whatever the limit, the program answers as without one: tests, switches, comparisons, fields, keys of a Map, texts that come from outside.
type Direction = "north" | "south" | "east" | "west";
type Size = "s" | "m" | "l" | "extra-large-beyond-any-register";
type Wide = "Ж" | "日本語" | "north";
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "triangle-with-a-long-name"; base: number; height: number };

const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail;

function isDirection(value: unknown): value is Direction { return value === "north" || value === "south" || value === "east" || value === "west"; }
function isSize(value: unknown): value is Size { return value === "s" || value === "m" || value === "l" || value === "extra-large-beyond-any-register"; }
function isWide(value: unknown): value is Wide { return value === "Ж" || value === "日本語" || value === "north"; }
function opposite(direction: Direction): Direction {
  switch (direction) {
    case "north": return "south";
    case "south": return "north";
    case "east": return "west";
    case "west": return "east";
  }
}
function area(shape: Shape): number {
  if (shape.kind === "circle") return Math.round(shape.radius * shape.radius * 3);
  if (shape.kind === "square") return shape.side * shape.side;
  return (shape.base * shape.height) / 2;
}
function rank(size: Size): number { return size === "s" ? 1 : size === "m" ? 2 : size === "l" ? 3 : 4; }

const made: unknown[] = hide([
  "north", "south", "east", "west", "nor" + String("th"), "xsouthx".slice(1, 6), ["e", "a", "s", "t"].join(""), "WEST".toLowerCase(), "North", "nort", "northh", "",
  "s", "m", "l", "extra-large-" + "beyond-any-register", "extra-large-beyond-any-registeR", "Ж", "日本" + "語", "日本", "ж", 1, null, undefined, true, {}, ["north"], Symbol("north"),
]);
for (const value of made) lines.push(`${typeof value === "symbol" ? "a symbol" : JSON.stringify(value)}: ${isDirection(value)} ${isSize(value)} ${isWide(value)}`);
for (const value of made) if (isDirection(value)) lines.push(value + " > " + opposite(value) + " > " + opposite(opposite(value)));
for (const value of made) if (isSize(value)) lines.push(value + " " + rank(value));

const shapes: Shape[] = hide<Shape[]>(JSON.parse('[{"kind":"circle","radius":2},{"kind":"square","side":3},{"kind":"triangle-with-a-long-name","base":4,"height":5}]'));
shapes.push({ kind: "square", side: 7 }, { kind: "circle", radius: 1 });
for (const shape of shapes) lines.push(shape.kind + " " + area(shape));

const count = new Map<Direction, number>();
const turns = Number(process.argv[2] ?? 2000);
const all: Direction[] = ["north", "east", "south", "west"];
let at: Direction = "north";
for (let i = 0; i < turns; i++) {
  at = i % 3 === 0 ? opposite(at) : all[(i * 7) % 4]!;
  count.set(at, (count.get(at) ?? 0) + 1);
}
lines.push([...count].map(([direction, times]) => direction + "=" + times).sort().join(" "));

// Literals that stand in types alone: no code names their texts, and still a value is tested for them where it comes in from code that knows nothing.
type Encoding = "utf-eight" | "latin-one" | "hexadecimal-digits-only";
type Level = "low" | "middling" | "high" | 7;
function lengthOf(encoding: Encoding): number { return encoding.length; }
function levelOf(level: Level): string { return typeof level + ":" + String(level).length; }
function record(entry: { encoding: Encoding; level?: Level }): string { return entry.encoding.toUpperCase() + "/" + entry.level; }
const unknownLengthOf: (value: any) => number = hide(lengthOf);
const unknownLevelOf: (value: any) => string = hide(levelOf);
const unknownRecord: (value: any) => string = hide(record);
const join = (...parts: string[]) => hide(parts).join("-");
for (const text of [join("utf", "eight"), join("latin", "one"), join("hexadecimal", "digits", "only"), join("utf", "nine"), join("low"), join("middling"), join("high"), join("")]) {
  for (const [name, call] of [["length", unknownLengthOf], ["level", unknownLevelOf]] as const) {
    try { lines.push(name + " " + text + ": " + call(text)); } catch (error) { lines.push(name + " " + text + ": " + (error as Error).constructor.name); }
  }
  try { lines.push("record " + unknownRecord({ encoding: text, level: text })); } catch (error) { lines.push("record " + text + ": " + (error as Error).constructor.name); }
}
lines.push(unknownLevelOf(7), unknownLevelOf(hide(3) + 4));

// The names of an object's members as a type: the read by such a key tests for each name.
const prices = { smallest: 1, "in-between": 2, largest: 3 } as const;
type Name = keyof typeof prices;
function priceOf(name: Name): number { return prices[name]; }
const names: Name[] = hide<Name[]>([join("smallest") as Name, join("in", "between") as Name, join("largest") as Name, "largest", "smallest"]);
for (const name of names) lines.push(name + " costs " + priceOf(name));
lines.push(String(priceOf(join("no", "such", "name") as Name)));

// A record by literal keys: the read and the store by such a key test for each of them. The text of one character is in no table of the program unless somebody asks for it.
function countOf(record: Partial<Record<Size, number>>, size: Size): number { return (record[size] ?? 0) + 1; }
const tally: Partial<Record<Size, number>> = {};
for (const size of ["s", "m", "s", "l", "s", "extra-large-beyond-any-register", "m"] as Size[]) tally[size] = countOf(tally, size);
for (const size of hide<Size[]>([join("s") as Size, join("l") as Size, join("extra", "large", "beyond", "any", "register") as Size])) tally[size] = countOf(tally, size);
lines.push(JSON.stringify(tally));
function narrowed(value: Size | number | undefined): string {
  if (typeof value === "string") return value === "l" ? "large" : "text " + value;
  return String(value);
}
lines.push(narrowed("l"), narrowed("s"), narrowed(4), narrowed(undefined), narrowed(hide<Size>(join("m") as Size)));

// Literals that nobody wrote: the members of a template literal type.
type Heading = `to-the-${Direction}`;
function headingOf(direction: Direction): Heading { return `to-the-${direction}`; }
function isEastward(heading: Heading): boolean { return heading === "to-the-east"; }
function loosely(value: Direction | (string & {})): boolean { return value === "west"; }
for (const direction of all) lines.push(headingOf(direction) + " " + isEastward(headingOf(direction)) + " " + loosely(direction) + " " + loosely(headingOf(direction)));
for (const direction of hide<Direction[]>([join("east") as Direction, join("up") as Direction])) lines.push(headingOf(direction) + " " + isEastward(headingOf(direction)));

class Sign { constructor(public direction: Direction, public size: Size) {} }
const signs = all.map((direction, i) => new Sign(direction, (["s", "m", "l", "extra-large-beyond-any-register"] as const)[i]!));
for (const sign of hide(signs)) lines.push(sign.direction + "/" + sign.size + " " + (sign.direction === "east") + " " + (sign.size === "extra-large-beyond-any-register") + " " + Object.values(sign).join());
console.log(lines.join("\n"));

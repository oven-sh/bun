// A store creates the field: an optional field of the layout, a name the layout does not know, on objects of the expected layout and on others, up to many more fields than the object had room for.
class Entry {
  id = 1;
  declare note?: string;
  declare score?: number;
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function setNote(entry: Entry, note: string): void {
  entry.note = note;
}
function setScore(entry: Entry, score: number): void {
  entry.score = score;
}
function noteOf(entry: Entry): unknown {
  return entry.note;
}
function scoreOf(entry: Entry): unknown {
  return entry.score;
}
function setUnknown(entry: any, value: unknown): void {
  entry.unknownToTheLayout = value;
}
function addMany(entry: any): void {
  entry.a0 = 0;
  entry.a1 = "one";
  entry.a2 = 2.5;
  entry.a3 = null;
  entry.a4 = [4];
  entry.a5 = true;
  entry.a6 = 6;
  entry.a7 = 7;
  entry.a8 = 8;
  entry.a9 = 9;
  entry.a10 = 10;
  entry.a11 = 11;
  entry.a12 = 12;
  entry.a13 = 13;
  entry.a14 = 14;
  entry.a15 = 15;
  entry.a16 = 16;
  entry.a17 = 17;
  entry.a18 = 18;
  entry.a19 = 19;
}
function look(mark: string, value: unknown): void {
  const entry = value as Entry;
  const before = String(noteOf(entry)) + "," + String(scoreOf(entry));
  const stores = [attempt(() => setScore(entry, 9.5)), attempt(() => setNote(entry, "noted")), attempt(() => setUnknown(entry, mark)), attempt(() => setNote(entry, "noted twice"))].join();
  console.log(mark + ":", before, stores, String(noteOf(entry)) + "," + String(scoreOf(entry)), Reflect.ownKeys(entry as object).map(String).join(), JSON.stringify(entry));
}

look("expected", new Entry());
look("expected", new Entry());
look("literal", { id: 2 });
look("literal that has one of them", { note: "had it", id: 3 });
look("parsed", JSON.parse('{"id":4}'));
look("parsed, empty", JSON.parse("{}"));
look("no prototype", Object.create(null));
look("array", [5]);
look("function", function () {});
look("map", new Map());
look("set", new Set([1]));
look("expected", new Entry());

const grown = new Entry();
addMany(grown);
setNote(grown, "after twenty");
console.log(JSON.stringify(grown), Object.keys(grown).length);
const grownFirst = new Entry();
setNote(grownFirst, "before twenty");
addMany(grownFirst);
setScore(grownFirst, 1);
console.log(JSON.stringify(grownFirst), Object.keys(grownFirst).length);
const grownParsed = JSON.parse('{"a5":"had a5"}');
addMany(grownParsed);
addMany(grownParsed);
setNote(grownParsed, "parsed");
console.log(JSON.stringify(grownParsed), Object.keys(grownParsed).length);

const one = new Entry();
const two = new Entry();
setNote(one, "one");
setScore(two, 2);
setScore(one, 1);
setNote(two, "two");
console.log(Object.keys(one).join(), Object.keys(two).join(), noteOf(one), noteOf(two), scoreOf(one), scoreOf(two));

export {};

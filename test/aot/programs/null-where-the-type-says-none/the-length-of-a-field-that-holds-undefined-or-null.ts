// `p.name.length`, `p.list[0]`, `p.name.charCodeAt(0)`, `p.list.length = 0`: the field is declared to hold a string or an array and holds undefined or null:
// the access throws the engine's own TypeError at its own place in the order of things, caught or not. (A compiled program does not quote the source text behind "evaluating".)
class Record {
  name: string;
  list: number[];
  next: Record;
  constructor(name: string, list: number[]) {
    this.name = name;
    this.list = list;
    this.next = this;
  }
}
const log: string[] = [];
function wordsOf(error: unknown): string {
  return (error as Error).message.replace(/ \(evaluating .*\)$/, "");
}
function note<T>(what: string, value: T): T {
  log.push(what);
  return value;
}
function lengthOfName(p: Record): number {
  return p.name.length;
}
function lengthOfList(p: Record): number {
  return p.list.length;
}
function firstOfList(p: Record): number {
  return p.list[0]!;
}
function elementOfList(p: Record, index: number): number {
  return p.list[note("index", index)]!;
}
function codeOfName(p: Record): number {
  return p.name.charCodeAt(note("position", 0));
}
function startOfName(p: Record): boolean {
  return p.name.startsWith("a");
}
function storeIntoList(p: Record): number {
  p.list[0] = note("stored value", 7);
  return p.list[0]!;
}
function cutList(p: Record): number {
  p.list.length = note("new length", 0);
  return p.list.length;
}
function twoLengths(p: Record): number {
  return p.name.length + p.next.name.length + p.next.list.length;
}
function lengthOrNothing(p: Record): number | undefined {
  return p.name?.length;
}
function caught(p: Record): string {
  try {
    return "length " + p.name.length;
  } catch (error) {
    return "caught " + wordsOf(error);
  } finally {
    log.push("finally");
  }
}
function lengthInLoop(records: Record[]): number {
  let total = 0;
  for (const record of records) total += record.name.length + record.list.length;
  return total;
}

function attempt(what: string, run: () => unknown) {
  log.length = 0;
  let answer: string;
  try {
    answer = String(run());
  } catch (error) {
    answer = (error as Error).constructor.name + ": " + wordsOf(error);
  }
  console.log(what, "|", answer, "|", log.join(","));
}

const whole = new Record("abc", [1, 2, 3]);
const holders: [string, Record][] = [["whole", whole]];
for (const nothing of [undefined, null]) {
  const noName = new Record("x", [4]);
  (noName as any).name = nothing;
  const noList = new Record("yz", [5]);
  (noList as any).list = nothing;
  const far = new Record("far", [6, 7]);
  far.next = noName;
  holders.push([`name ${nothing}`, noName], [`list ${nothing}`, noList], [`next's name ${nothing}`, far]);
}
for (let round = 0; round < 3; round++) {
  for (const [what, record] of holders) {
    attempt(what + " lengthOfName", () => lengthOfName(record));
    attempt(what + " lengthOfList", () => lengthOfList(record));
    attempt(what + " firstOfList", () => firstOfList(record));
    attempt(what + " elementOfList", () => elementOfList(record, 1));
    attempt(what + " codeOfName", () => codeOfName(record));
    attempt(what + " startOfName", () => startOfName(record));
    attempt(what + " twoLengths", () => twoLengths(record));
    attempt(what + " lengthOrNothing", () => lengthOrNothing(record));
    attempt(what + " caught", () => caught(record));
    attempt(what + " lengthInLoop", () => lengthInLoop([whole, record, whole]));
  }
}
for (const [what, record] of holders) {
  attempt(what + " storeIntoList", () => storeIntoList(record));
  attempt(what + " cutList", () => cutList(record));
}
attempt("no record", () => lengthOfName(undefined as any));
attempt("null for a record", () => lengthOfList(null as any));
// What is no string and no array, and neither undefined nor null, is read as what it is.
const odd = new Record("odd", []);
(odd as any).name = 12;
(odd as any).list = { length: "long", 0: "first" };
attempt("a number for a name", () => lengthOfName(odd));
attempt("an object for a list", () => [lengthOfList(odd), firstOfList(odd)]);

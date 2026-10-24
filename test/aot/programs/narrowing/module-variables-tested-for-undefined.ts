// Module variables that start as undefined (`var`: there is no dead zone and no store at the declaration) and are only ever tested before use. Every test has to tell undefined from each other value the variable can hold, among them null, zero, the empty string and false, and has to see undefined again after it was stored back.
class Entry {
  constructor(public id: number) {}
}

var cached: Entry | undefined;
var nullable: Entry | null | undefined;
var anyValue: unknown;
var counter: number | undefined;

function idOrMinusOne(): number {
  const entry = cached;
  if (entry === undefined) return -1;
  return entry.id;
}
function idUnlessNullish(): number {
  const entry = nullable;
  if (entry == null) return -2;
  return entry.id;
}
function kindOfNullable(): string {
  const entry = nullable;
  if (entry === undefined) return "undefined";
  return entry === null ? "null" : "entry " + entry.id;
}
function isSet(): boolean {
  return anyValue !== undefined;
}
function isNullish(): boolean {
  return anyValue == null;
}
function lazily(): Entry {
  const entry = cached;
  if (entry !== undefined) return entry;
  return (cached = new Entry(1000));
}
function next(): number {
  const n = counter;
  if (n === undefined) return (counter = 0);
  return (counter = n + 1);
}

const log: string[] = [];
function report(label: string) {
  log.push(`${label}: ${idOrMinusOne()} ${idUnlessNullish()} ${kindOfNullable()} ${isSet()} ${isNullish()} ${next()}`);
}

report("at the start");
const values: unknown[] = [undefined, null, 0, -0, "", false, NaN, 0n, [], {}, Symbol.iterator, () => undefined, new Entry(7)];
for (let i = 0; i < values.length; i++) {
  anyValue = values[i];
  cached = i % 3 === 0 ? undefined : new Entry(i);
  nullable = i % 4 === 0 ? undefined : i % 4 === 1 ? null : new Entry(-i);
  if (i % 5 === 4) counter = undefined;
  report("value " + i);
}
cached = undefined;
log.push("made lazily: " + lazily().id + " " + lazily().id + " " + idOrMinusOne());
cached = undefined;
nullable = undefined;
anyValue = undefined;
counter = undefined;
report("cleared");

let sum = 0;
for (let i = 0; i < 20000; i++) {
  cached = i & 1 ? new Entry(i) : undefined;
  nullable = i % 3 === 0 ? null : i % 3 === 1 ? undefined : cached;
  sum += idOrMinusOne() + idUnlessNullish() + next();
}
log.push("sum " + sum);
console.log(log.join("\n"));

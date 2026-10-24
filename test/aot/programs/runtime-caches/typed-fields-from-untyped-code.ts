// Untyped code reads, stores, creates and deletes fields, extra properties and class members of typed objects, by name and by key. Each access runs in a loop until it is cached, then the cached answer is invalidated.
const turns: number = JSON.parse("40");
const box: any[] = JSON.parse("[0]");
function hidden(value: unknown): any { box[0] = value; return box[0]; }
function said(run: () => unknown): string { try { return String(run()); } catch (error) { return "threw " + (error as Error).constructor.name; } }
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" ")); }

class Sample { flag: boolean = true; maybeFlag: boolean | undefined = undefined; small: number = 1; real: number = 1.5; either: number = 1; maybeNumber: number | undefined = undefined; text: string = "a"; big: bigint = 10n; link: Sample | null = null; loose: any = 0; declare late?: number;
  handler = () => this.small; method() { return this.small + 1; } get doubled() { return this.small * 2; } set doubled(value: number) { this.small = value / 2; } }
type Entry = { id: number; note?: string };
function makeEntry(id: number): Entry { return { id }; }
const fieldNames: string[] = JSON.parse('["flag","maybeFlag","small","real","either","maybeNumber","text","big","link","loose"]');
const int32AndDoubleValues: any[] = JSON.parse("[1.5,2,-0,2147483648]");

function valuesFor(o: any, i: number): any[] {
  return hidden([i % 2 === 0, i % 3 ? true : undefined, i, i + 0.5, int32AndDoubleValues[i % 4], i % 3 ? i : undefined, "t" + i, BigInt(i), i % 2 ? o : null, i % 2 ? "s" : i]);
}
function readByName(o: any): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) {
    answers.add(o.flag + " " + o.maybeFlag + " " + o.small + " " + o.real + " " + o.either + " " + o.maybeNumber + " " + o.text + " " + o.big + " " + o.link + " " + o.loose);
  }
  return [...answers].join(" | ");
}
function readByKey(o: any, names: string[]): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) {
    const values: string[] = [];
    for (let k = 0; k < names.length; k++) values.push("" + o[names[k]]);
    answers.add(values.join(" "));
  }
  return [...answers].join(" | ");
}
function storeByName(o: any, i: number): void {
  for (let round = 0; round < turns; round++, i++) {
    const values = valuesFor(o, i);
    o.flag = values[0];
    o.maybeFlag = values[1];
    o.small = values[2];
    o.real = values[3];
    o.either = values[4];
    o.maybeNumber = values[5];
    o.text = values[6];
    o.big = values[7];
    o.link = values[8];
    o.loose = values[9];
  }
}
function storeByKey(o: any, names: string[], i: number): void {
  for (let round = 0; round < turns; round++, i++) {
    const values = valuesFor(o, i);
    for (let k = 0; k < names.length; k++) o[names[k]] = values[k];
  }
}
const sample = new Sample();
const untypedSample = hidden(sample);
say("created, read by name", readByName(untypedSample));
say("created, read by key", readByKey(untypedSample, fieldNames));
for (const first of [1, 2, 3]) {
  storeByName(untypedSample, first);
  say("stored by name, read by name", readByName(untypedSample));
  say("stored by name, read by key", readByKey(untypedSample, fieldNames));
  storeByKey(untypedSample, fieldNames, first + 3);
  say("stored by key, read by name", readByName(untypedSample));
  say("stored by key, read by key", readByKey(untypedSample, fieldNames));
  say("stored by key, read by typed code", sample.small + sample.real, sample.text, sample.link === sample);
}

function storeEither(o: any, value: any): void {
  for (let i = 0; i < turns; i++) o.either = value;
}
function readEither(o: any, key: string): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) answers.add(o.either + " " + Object.is(o.either, -0) + " " + o[key] + " " + Object.is(o[key], -0));
  return [...answers].join(" | ");
}
for (const value of int32AndDoubleValues) {
  storeEither(untypedSample, value);
  say("int32 or double", readEither(untypedSample, fieldNames[4]), sample.either, Object.is(sample.either, -0));
}

function readNote(o: any): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) answers.add(o.note + " " + ("note" in o));
  return [...answers].join(" | ");
}
const entry = makeEntry(1);
const untypedEntry = hidden(entry);
say("optional record field, absent", readNote(untypedEntry), entry.note);
untypedEntry.note = "n";
say("optional record field, stored", readNote(untypedEntry), entry.note);
delete untypedEntry.note;
say("optional record field, deleted", readNote(untypedEntry), entry.note);

function readLate(o: any): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) answers.add(o.late + " " + ("late" in o) + " " + Object.hasOwn(o, "late"));
  return [...answers].join(" | ");
}
const partial = new Sample();
const untypedPartial = hidden(partial);
say("optional class field, absent", readLate(untypedPartial), partial.late);
untypedPartial.late = 5;
say("optional class field, stored", readLate(untypedPartial), partial.late);
delete untypedPartial.late;
say("optional class field, deleted", readLate(untypedPartial), partial.late);
(Sample.prototype as any).late = 9;
say("optional class field, absent below a prototype property", readLate(untypedPartial), partial.late);
delete (Sample.prototype as any).late;
say("optional class field, prototype property deleted", readLate(untypedPartial), partial.late);

function createLate(create: () => Sample): string {
  let sum = 0;
  let last = create();
  for (let i = 0; i < turns; i++) {
    last = create();
    hidden(last).late = i;
    sum += last.late!;
  }
  return sum + " " + Object.keys(last).join();
}
say("field created by an untyped store", createLate(() => new Sample()));
say("field created on a frozen object", said(() => createLate(() => Object.freeze(new Sample()))));
say("field created on a non-extensible object", said(() => createLate(() => Object.preventExtensions(new Sample()))));
say("field created by an untyped store again", createLate(() => new Sample()));

let seen: unknown = "nothing";
function addExtra(): any {
  let o: any;
  for (let i = 0; i < turns; i++) {
    o = hidden(new Sample());
    o.extra = i;
  }
  return o;
}
function storeExtra(o: any): void {
  for (let i = 0; i < turns; i++) o.extra = 100 + i;
}
function readExtra(o: any): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) answers.add(o.extra + " " + ("extra" in o));
  return [...answers].join(" | ");
}
const extended = addExtra();
say("extra property, added", readExtra(extended));
storeExtra(extended);
say("extra property, replaced", readExtra(extended));
delete extended.extra;
say("extra property, deleted", readExtra(extended));
Object.defineProperty(extended, "extra", { get() { return 7; }, set(v) { seen = v; }, configurable: true });
storeExtra(extended);
say("extra property, accessor", readExtra(extended), seen, Object.keys(extended).join());
Object.defineProperty(Sample.prototype, "extra", { set(v) { seen = "prototype " + v; }, configurable: true });
say("extra property, added below a prototype setter", Object.hasOwn(addExtra(), "extra"), seen);
delete (Sample.prototype as any).extra;
say("extra property, prototype setter deleted", Object.hasOwn(addExtra(), "extra"), seen);

function addAndReadExtra(create: () => unknown): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const o = hidden(create());
    o.extra = i;
    sum += o.extra;
  }
  return sum;
}
class BelowProxy { own: number = 1; }
let trapCalls = 0;
Object.setPrototypeOf(BelowProxy.prototype, new Proxy({}, { set(target, key, value, receiver) { trapCalls++; return Reflect.set(target, key, value, receiver); } }));
say("extra property, added by a proxy on the prototype chain", addAndReadExtra(() => new BelowProxy()), trapCalls);
class BelowDefiningSetter { own: number = 1; }
let setterCalls = 0;
Object.defineProperty(BelowDefiningSetter.prototype, "extra", { set(value) { setterCalls++; Object.defineProperty(this, "extra", { value, writable: true, enumerable: true, configurable: true }); }, configurable: true });
say("extra property, added by a prototype setter", addAndReadExtra(() => new BelowDefiningSetter()), setterCalls);

function useMembers(o: any): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) {
    o.doubled = 8;
    answers.add(o.method() + " " + o.doubled + " " + o.small);
  }
  return [...answers].join(" | ");
}
const instance = new Sample();
const untypedInstance = hidden(instance);
say("class members", useMembers(untypedInstance), instance.method(), instance.doubled);
Sample.prototype.method = function () { return -1; };
say("class members, method replaced", useMembers(untypedInstance), instance.method(), instance.doubled);
Object.defineProperty(Sample.prototype, "doubled", { get() { return -2; }, set(value) { this.small = value; }, configurable: true });
say("class members, accessor replaced", useMembers(untypedInstance), instance.method(), instance.doubled);

function readHandler(o: any, typed: Sample): string {
  const answers = new Set<string>();
  for (let i = 0; i < turns; i++) answers.add((o.handler === o.handler) + " " + o.handler() + " " + (typed.handler === o.handler));
  return [...answers].join(" | ");
}
const listener = new Sample();
const untypedListener = hidden(listener);
say("closure in a field", readHandler(untypedListener, listener));
untypedListener.handler = () => 5;
say("closure in a field, replaced", readHandler(untypedListener, listener));

console.log(lines.join("\n"));
export {};

// A WeakRef, a WeakMap key, a WeakSet member and a FinalizationRegistry keep nothing, and yet the object they are handed must be a real cell of the heap: they find it again as long as somebody holds it, and they are told when it dies, not before.
import { fullGC } from "bun:jsc";
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  fullGC();
  return read();
}
interface Thing {
  n: number;
  tag: string;
}
function weakly(t: Thing): WeakRef<Thing> {
  return new WeakRef(t);
}
const marks = new WeakMap<Thing, string>();
function mark(t: Thing): void {
  marks.set(t, "marked " + t.tag);
}
const members = new WeakSet<Thing>();
function enroll(t: Thing): void {
  members.add(t);
}
const finalized: string[] = [];
const registry = new FinalizationRegistry<string>(held => finalized.push(held));
function watch(t: Thing): void {
  registry.register(t, "finalized " + t.tag);
}
function watchWithToken(t: Thing, token: object): void {
  registry.register(t, "never reported " + t.tag, token);
}

// While the caller holds the object, everything finds it.
function heldThroughout(i: number): string {
  const thing = { n: i, tag: "held" + i };
  const ref = weakly(thing);
  mark(thing);
  enroll(thing);
  watch(thing);
  churn(12);
  const back = ref.deref();
  return [back === thing, back && back.tag, marks.get(thing), members.has(thing), marks.has({ n: i, tag: "held" + i })].join();
}
let line = "";
for (let i = 0; i < 40; i++) line = heldThroughout(i);
console.log(line);

// Objects that live on in a list are never reported, and their weak references never go empty.
const living: Thing[] = [];
const refs: WeakRef<Thing>[] = [];
for (let i = 0; i < 100; i++) {
  const thing = { n: i, tag: "living" + i };
  refs.push(weakly(thing));
  watch(thing);
  mark(thing);
  living.push(thing);
}
for (let round = 0; round < 3; round++) {
  churn(40);
  await new Promise(resolve => setTimeout(resolve, 1));
}
console.log(refs.every((ref, i) => ref.deref() === living[i]), living.every(t => marks.get(t) === "marked " + t.tag), finalized.filter(text => text.includes("living")).length);

// Objects that nobody holds: a weak reference answers the object itself or nothing, never anything else, and what is reported is reported once.
function dropped(i: number): WeakRef<Thing> {
  const thing = { n: i, tag: "dropped" + i };
  watch(thing);
  return weakly(thing);
}
const droppedRefs: WeakRef<Thing>[] = [];
for (let i = 0; i < 200; i++) droppedRefs.push(dropped(i));
for (let round = 0; round < 4; round++) {
  churn(60);
  await new Promise(resolve => setTimeout(resolve, 1));
}
console.log(droppedRefs.every((ref, i) => {
  const thing = ref.deref();
  return thing === undefined || (thing.n === i && thing.tag === "dropped" + i);
}));
const reports = finalized.filter(text => text.includes("dropped"));
console.log(new Set(reports).size === reports.length, reports.every(text => /^finalized dropped\d+$/.test(text)));
// What was reported dead is dead for its weak reference too.
console.log(reports.every(text => droppedRefs[Number(text.slice("finalized dropped".length))].deref() === undefined));

// Unregistered in time: no report.
const tokens: object[] = [];
for (let i = 0; i < 50; i++) {
  const token = { i };
  tokens.push(token);
  watchWithToken({ n: i, tag: "token" + i }, token);
}
console.log(tokens.every(token => registry.unregister(token)));
for (let round = 0; round < 3; round++) {
  churn(40);
  await new Promise(resolve => setTimeout(resolve, 1));
}
console.log(finalized.filter(text => text.includes("never reported")).length);

// The object is its own token and the held value is another fresh object.
const heldObjects: { of: string }[] = [];
const second = new FinalizationRegistry<{ of: string }>(held => heldObjects.push(held));
function watchWithObject(t: Thing, held: { of: string }): void {
  second.register(t, held, t);
}
for (let i = 0; i < 100; i++) watchWithObject({ n: i, tag: "x" + i }, { of: "held value " + i });
for (let round = 0; round < 3; round++) {
  churn(40);
  await new Promise(resolve => setTimeout(resolve, 1));
}
console.log(heldObjects.every(held => /^held value \d+$/.test(held.of)));

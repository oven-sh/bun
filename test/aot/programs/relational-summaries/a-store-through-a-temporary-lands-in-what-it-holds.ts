// `temp.slot = longLived; temp.slot.held = value`: the store names the temporary, and the value lands in the long-lived object. An object that a function made itself, or was handed for the one call, is a second name for whatever was put into it: what is stored through it is kept by that, not by the temporary.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Value {
  tag: string;
}
interface Keeper {
  name: string;
  held: Value | null;
  all: Value[];
}
interface Temp {
  slot: Keeper | null;
}
const keeper = (name: string): Keeper => ({ name, held: null, all: [] });

// The temporary is made here.
function throughOwnObject(k: Keeper, v: Value): void {
  const temp = { slot: k };
  temp.slot.held = v;
}
function throughOwnArray(k: Keeper, v: Value): void {
  const temp = [k];
  temp[0].held = v;
}
function throughTwoOwnObjects(k: Keeper, v: Value): void {
  const temp = { inner: { slot: k } };
  temp.inner.slot.held = v;
}
function throughOwnObjectAndPush(k: Keeper, v: Value): void {
  const temp = { slot: k };
  temp.slot.all.push(v);
}
function throughDestructuring(k: Keeper, v: Value): void {
  const { slot } = { slot: k };
  slot.held = v;
}
function throughSpread(k: Keeper, v: Value): void {
  const temp = { ...{ slot: k } };
  temp.slot.held = v;
}
function throughOwnClosure(k: Keeper, v: Value): void {
  const get = () => k;
  get().held = v;
}
function throughOwnMap(k: Keeper, v: Value): void {
  const temp = new Map([["slot", k]]);
  temp.get("slot")!.held = v;
}
class Wrapper {
  constructor(public slot: Keeper) {}
  fill(v: Value): void {
    this.slot.held = v;
  }
}
function throughOwnInstance(k: Keeper, v: Value): void {
  new Wrapper(k).fill(v);
}
// The temporary is handed in, by a caller that made it for the call.
function throughParameter(temp: Temp, k: Keeper, v: Value): void {
  temp.slot = k;
  temp.slot.held = v;
}
function fillSlot(temp: Temp, v: Value): void {
  temp.slot!.held = v;
}
function throughParameterInTwoCalls(temp: Temp, k: Keeper, v: Value): void {
  temp.slot = k;
  fillSlot(temp, v);
}
function throughList(temp: Keeper[], k: Keeper, v: Value): void {
  temp.push(k);
  temp[temp.length - 1].held = v;
}
// The caller filled the temporary.
function callerFilled(temp: Temp, v: Value): void {
  temp.slot!.held = v;
}
// What is read back out of the temporary is returned, and the caller stores into the answer.
function unwrap(temp: Temp): Keeper {
  return temp.slot!;
}
const ways: [string, (k: Keeper, v: Value) => void][] = [
  ["own object", throughOwnObject],
  ["own array", throughOwnArray],
  ["two own objects", throughTwoOwnObjects],
  ["destructuring", throughDestructuring],
  ["spread", throughSpread],
  ["own closure", throughOwnClosure],
  ["own map", throughOwnMap],
  ["own instance", throughOwnInstance],
];
const k1 = keeper("own object");
const k2 = keeper("own array");
const k3 = keeper("two own objects");
const k4 = keeper("push");
const k5 = keeper("destructuring");
const k6 = keeper("spread");
const k7 = keeper("own closure");
const k8 = keeper("own map");
const k9 = keeper("own instance");
const k10 = keeper("parameter");
const k11 = keeper("two calls");
const k12 = keeper("list");
const k13 = keeper("caller filled");
const k14 = keeper("unwrapped");
const everyKeeper = [k1, k2, k3, k4, k5, k6, k7, k8, k9, k10, k11, k12, k13, k14];
const history: string[] = [];
for (let i = 0; i < 400; i++) {
  throughOwnObject(k1, { tag: "v1." + i });
  throughOwnArray(k2, { tag: "v2." + i });
  throughTwoOwnObjects(k3, { tag: "v3." + i });
  throughOwnObjectAndPush(k4, { tag: "v4." + i });
  throughDestructuring(k5, { tag: "v5." + i });
  throughSpread(k6, { tag: "v6." + i });
  throughOwnClosure(k7, { tag: "v7." + i });
  throughOwnMap(k8, { tag: "v8." + i });
  throughOwnInstance(k9, { tag: "v9." + i });
  throughParameter({ slot: null }, k10, { tag: "v10." + i });
  throughParameterInTwoCalls({ slot: null }, k11, { tag: "v11." + i });
  throughList([], k12, { tag: "v12." + i });
  callerFilled({ slot: k13 }, { tag: "v13." + i });
  unwrap({ slot: k14 }).held = { tag: "v14." + i };
  if (i % 133 === 132) {
    churn(40);
    history.push(everyKeeper.map(k => (k.held ? k.held.tag : k.all[k.all.length - 1].tag)).join());
  }
}
console.log(churn(60));
console.log(history.join("\n"));
console.log(everyKeeper.map(k => k.name + "=" + (k.held ? k.held.tag : k.all.length + ":" + k.all[200].tag)).join(" | "));
for (const [name, way] of ways) {
  const k = keeper(name);
  way(k, { tag: "by value " + name });
  churn(5);
  console.log(k.held!.tag);
}

// The other direction: the long-lived object is read out of a temporary and the VALUE is what the temporary holds.
function moveAcross(from: { value: Value }, to: Keeper): void {
  to.held = from.value;
}
function moveThroughOwn(v: Value, to: Keeper): void {
  const carrier = { value: v };
  moveAcross(carrier, to);
}
function moveThroughTwo(v: Value, to: Keeper): void {
  const carrier = { box: { value: v } };
  moveAcross(carrier.box, to);
}
const target = keeper("target");
const target2 = keeper("target 2");
const target3 = keeper("target 3");
for (let i = 0; i < 300; i++) {
  moveAcross({ value: { tag: "moved " + i } }, target);
  moveThroughOwn({ tag: "moved through one " + i }, target2);
  moveThroughTwo({ tag: "moved through two " + i }, target3);
}
console.log(churn(60), target.held!.tag, target2.held!.tag, target3.held!.tag);

// What was put into the temporary is read back out of it, and then kept, written, compared, called: all of that happens to the caller's own object, of which the callee's record only says "stored into parameter 0".
interface Counter {
  n: number;
  tag: string;
}
interface Carrier {
  inside: Counter | null;
}
const keptCounters: Counter[] = [];
function putAndKeep(carrier: Carrier, c: Counter): void {
  carrier.inside = c;
  if (carrier.inside.n % 100 === 99) keptCounters.push(carrier.inside);
}
function putAndWrite(carrier: Carrier, c: Counter): void {
  carrier.inside = c;
  carrier.inside.n = -5;
}
function putAndReturn(carrier: Carrier, c: Counter): Counter {
  carrier.inside = c;
  return carrier.inside;
}
function putAndDelete(carrier: Carrier, c: Counter): void {
  carrier.inside = c;
  delete (carrier.inside as Partial<Counter>).tag;
}
function putAndFreeze(carrier: Carrier, c: Counter): void {
  carrier.inside = c;
  Object.freeze(carrier.inside);
}
function putAndThrow(carrier: Carrier, c: Counter): void {
  carrier.inside = c;
  if (c.n % 100 === 98) throw carrier.inside;
}
function putInOneCallWriteInTheNext(carrier: Carrier, c: Counter): void {
  justPut(carrier, c);
  justWrite(carrier);
}
function justPut(carrier: Carrier, c: Counter): void {
  carrier.inside = c;
}
function justWrite(carrier: Carrier): void {
  carrier.inside!.n = -7;
}
let seenByTheCaller = "";
const thrownCounters: Counter[] = [];
for (let i = 0; i < 300; i++) {
  putAndKeep({ inside: null }, { n: i, tag: "kept through a carrier " + i });
  const written = { n: i, tag: "written" };
  putAndWrite({ inside: null }, written);
  const returned = { n: i, tag: "returned" };
  const back = putAndReturn({ inside: null }, returned);
  const cut = { n: i, tag: "cut" };
  putAndDelete({ inside: null }, cut);
  const hard = { n: i, tag: "hard" };
  putAndFreeze({ inside: null }, hard);
  const later = { n: i, tag: "later" };
  putInOneCallWriteInTheNext({ inside: null }, later);
  try {
    putAndThrow({ inside: null }, { n: i, tag: "thrown through a carrier " + i });
  } catch (error) {
    thrownCounters.push(error as Counter);
  }
  seenByTheCaller = [written.n, back === returned, "tag" in cut, Object.isFrozen(hard), later.n].join();
}
console.log(seenByTheCaller, churn(60), keptCounters.map(c => c.tag).join(" | "), thrownCounters.map(c => c.tag).join(" | "));

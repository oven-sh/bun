// A parameter of which only fields are read may be passed as those fields, if the fields are read at the call. But the callee reads them later: after a callback, another call, a store through an alias, an await, a getter, a thrown error. Whatever changed the object in between must be seen, and a read that never happens must not happen.
interface Box {
  value: number;
  label: string;
}
function afterACallback(box: Box, before: () => void): number {
  before();
  return box.value;
}
function betweenTwoReads(box: Box, between: () => void): string {
  const first = box.value;
  between();
  return first + ">" + box.value;
}
function afterAStoreThroughAnAlias(box: Box, alias: Box): number {
  alias.value = -1;
  return box.value;
}
function afterAStoreThroughAHolder(box: Box, holder: { inner: Box }): number {
  holder.inner.value = -2;
  return box.value;
}
const registered: Box[] = [];
function afterAGlobalSweep(box: Box): number {
  for (const each of registered) each.value = -3;
  return box.value;
}
function onlyOnOnePath(box: Box | null, wanted: boolean): number {
  return wanted ? box!.value : 0;
}
function afterAThrow(box: Box | null, fail: boolean): number {
  if (fail) throw new Error("before the read");
  return box!.value;
}
function inALoop(box: Box, rounds: number, each: (i: number) => void): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    sum += box.value;
    each(i);
  }
  return sum;
}
function secondAfterFirstsGetter(a: Box, b: Box): number {
  return a.value + b.value;
}
async function afterAnAwait(box: Box): Promise<number> {
  await null;
  return box.value;
}
function argumentsInOrder(a: number, box: Box, c: number): string {
  return a + "," + box.value + "," + c;
}
let line = "";
let warm = 0;
for (let i = 0; i < 400; i++) {
  const box: Box = { value: i, label: "box" };
  warm += afterACallback({ value: i, label: "" }, () => {}) + onlyOnOnePath({ value: i, label: "" }, true) + afterAThrow({ value: i, label: "" }, false);
  const results = [
    afterACallback(box, () => {
      box.value += 1000;
    }),
    betweenTwoReads(box, () => {
      box.value = 7;
    }),
    afterAStoreThroughAnAlias(box, box),
    afterAStoreThroughAnAlias(box, { value: 0, label: "another" }),
    afterAStoreThroughAHolder(box, { inner: box }),
    afterAStoreThroughAHolder(box, { inner: { value: 0, label: "another" } }),
    inALoop(box, 3, n => {
      box.value = n * 10;
    }),
  ];
  if (i === 399) registered.push(box);
  results.push(afterAGlobalSweep(box), afterAGlobalSweep({ value: 5, label: "not registered" }));
  line = results.join();
}
console.log(warm, line);

// Reads that must not happen.
console.log(onlyOnOnePath(null, false));
try {
  afterAThrow(null, true);
} catch (error) {
  console.log((error as Error).message);
}
try {
  afterAThrow(null, false);
} catch (error) {
  console.log((error as Error).constructor.name);
}
const log: string[] = [];
const spy = (name: string, value: number): Box => ({
  label: name,
  get value() {
    log.push("read " + name);
    return value;
  },
});
console.log(onlyOnOnePath(spy("unwanted", 1), false), onlyOnOnePath(spy("wanted", 2), true), log.splice(0).join());
console.log(afterACallback(spy("late", 3), () => log.push("callback")), log.splice(0).join());
console.log(betweenTwoReads(spy("twice", 4), () => log.push("between")), log.splice(0).join());
console.log(inALoop(spy("looped", 5), 2, i => log.push("round " + i)), inALoop(spy("never", 6), 0, () => {}), log.splice(0).join());

// The first object's getter changes the second object.
const second: Box = { value: 1, label: "second" };
const first: Box = {
  label: "first",
  get value() {
    second.value = 100;
    return 1;
  },
};
console.log(secondAfterFirstsGetter(first, second), (second.value = 1), secondAfterFirstsGetter(second, first));

// The caller changes the object after the call has returned a promise.
const awaited: Box = { value: 1, label: "awaited" };
const promise = afterAnAwait(awaited);
awaited.value = 2;
console.log(await promise);

// The operands of the call are evaluated left to right, and the object is read inside.
let counter = 0;
const shared: Box = { value: 0, label: "shared" };
const bump = () => (shared.value = ++counter);
console.log(argumentsInOrder(bump(), shared, bump()), argumentsInOrder(shared.value, shared, (shared.value = 50)));

// A field is deleted, redefined, or the object is swapped for another kind between the call and the read.
function afterDelete(o: { value?: number }, act: (o: { value?: number }) => void): string {
  act(o);
  return String(o.value) + "/" + ("value" in o);
}
console.log(
  afterDelete({ value: 1 }, o => delete o.value),
  afterDelete({ value: 1 }, o => Object.defineProperty(o, "value", { get: () => 9 })),
  afterDelete({ value: 1 }, o => Object.setPrototypeOf(o, { value: 8 })),
  afterDelete({ value: 1 }, o => (delete o.value, Object.setPrototypeOf(o, { value: 8 }))),
  afterDelete({ value: 1 }, o => Object.freeze(o)),
  afterDelete({}, o => (o.value = 3)),
);

// Writes by the callee are seen by the caller, in the caller's order.
function writesThenCalls(box: Box, observe: () => void): void {
  box.value = 1;
  observe();
  box.value = 2;
  observe();
}
function observed(i: number): string {
  const box: Box = { value: 0, label: "written" + i };
  const seen: number[] = [];
  writesThenCalls(box, () => seen.push(box.value));
  return seen.join() + "," + box.value;
}
for (let i = 0; i < 200; i++) line = observed(i);
console.log(line);

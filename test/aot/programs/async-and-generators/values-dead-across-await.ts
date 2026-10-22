// 1,000 calls of an async function are suspended at one await: the collector frees the object that only a local dead after the await refers to, and retains the object that the call reads after it resumes.
class Payload {
  constructor(
    public id: number,
    public label: string,
  ) {}
}

const callCount = 1000;
// The collector scans the stack conservatively, so a stale word may retain a few dead objects.
const minCollectedCount = 900;
const idChange = 5000;
const deadReferences: WeakRef<Payload>[] = [];
const liveReferences: WeakRef<Payload>[] = [];
let openGate: () => void = () => {};
const gate = new Promise<void>(resolve => {
  openGate = resolve;
});

function watch(payload: Payload, references: WeakRef<Payload>[]): void {
  references.push(new WeakRef(payload));
}
function weigh(payload: Payload): number {
  return payload.id + payload.label.length;
}
function turn(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

// `dead` is live across calls, so a stack slot or a callee-saved register may still refer to it at the await.
async function waitAtGate(index: number): Promise<number> {
  const dead = new Payload(index, "dead");
  const live = new Payload(index * 2, "live" + index);
  watch(dead, deadReferences);
  watch(live, liveReferences);
  const deadWeight = weigh(dead);
  await gate;
  return deadWeight + weigh(live);
}

const pendingResults: Promise<number>[] = [];
for (let index = 0; index < callCount; index++) pendingResults.push(waitAtGate(index));
// A WeakRef refers to its target strongly until the job that created it ends.
await turn();
Bun.gc(true);

let collectedDeadCount = 0;
for (const reference of deadReferences) if (!reference.deref()) collectedDeadCount++;
console.log(collectedDeadCount >= minCollectedCount ? "dead objects were collected" : "dead objects retained: " + (callCount - collectedDeadCount));

// This store rules out reading `id` before the await, so each call needs its live object after it resumes.
let collectedLiveCount = 0;
for (const reference of liveReferences) {
  const live = reference.deref();
  if (live) live.id += idChange;
  else collectedLiveCount++;
}
console.log(collectedLiveCount === 0 ? "live objects were retained" : "live objects collected: " + collectedLiveCount);

openGate();
let wrongCount = 0;
let sum = 0;
for (let index = 0; index < callCount; index++) {
  const result = await pendingResults[index];
  if (result !== index + "dead".length + index * 2 + idChange + ("live" + index).length) wrongCount++;
  sum += result;
}
console.log(`${callCount} calls resumed, ${wrongCount} wrong results, sum ${sum}`);
export {};

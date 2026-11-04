// A function that waits holds what it reads behind the wait: also what a closure captured, or what a field of an object held, where neither the closure nor the object is ever made.
// Behind the wait the program stores null there. From then on nothing holds the object, as in plain Bun: this is how a test for a leak is written.
// Alone: what is let go of goes by which bodies are copied into which, and that by all that the executable holds
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 1));
function collect(): void {
  const junk: object[] = [];
  for (let i = 0; i < 20000; i++) junk.push({ i });
  Bun.gc(true);
}
class Holder {
  inner: object | null = { big: new Array(100).fill(0) };
  dispose(): void {
    this.inner = null;
  }
}
async function closureStoresNull(): Promise<boolean> {
  let thing: object | null = { big: new Array(100).fill(0) };
  const seen = new WeakRef(thing);
  const cleanUp = (): void => {
    thing = null;
  };
  await tick();
  cleanUp();
  await tick();
  collect();
  return seen.deref() !== undefined;
}
async function closureStoresNullRightBeforeTheCollection(): Promise<boolean> {
  let thing: object | null = { big: new Array(100).fill(0) };
  const seen = new WeakRef(thing);
  const cleanUp = (): void => {
    thing = null;
  };
  await tick();
  cleanUp();
  collect();
  return seen.deref() !== undefined;
}
async function methodStoresNull(): Promise<boolean> {
  const holder = new Holder();
  const seen = new WeakRef(holder.inner!);
  await tick();
  holder.dispose();
  await tick();
  collect();
  return seen.deref() !== undefined;
}
for (const [name, once] of [
  ["a closure stores null", closureStoresNull],
  ["a closure stores null right before the collection", closureStoresNullRightBeforeTheCollection],
  ["a method stores null", methodStoresNull],
] as const) {
  let kept = 0;
  for (let round = 0; round < 5; round++) if (await once()) kept++;
  console.log(name + ": " + (kept ? "KEPT in " + kept + " of 5" : "collected"));
}

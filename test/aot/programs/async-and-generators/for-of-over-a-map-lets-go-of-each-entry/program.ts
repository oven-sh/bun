declare function gc(): void;

class Body {
  bytes: number[] = new Array<number>(32).fill(1);
}

let watched: WeakRef<Body>[] = [];
let open: () => void = () => {};
let gate: Promise<void> = Promise.resolve();

function body(): Body {
  const made = new Body();
  watched.push(new WeakRef(made));
  return made;
}
function size(of: Body): number {
  return of.bytes.length;
}
function turn(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

async function pattern(i: number): Promise<number> {
  const map = new Map<number, Body>([[1, body()]]);
  let n = i;
  for (const [key, big] of map) {
    map.delete(key);
    n += size(big);
    await gate;
  }
  return n;
}
async function pair(i: number): Promise<number> {
  const map = new Map<number, Body>([[1, body()]]);
  let n = i;
  for (const entry of map) {
    map.delete(entry[0]);
    n += size(entry[1]);
    await gate;
  }
  return n;
}
async function entries(i: number): Promise<number> {
  const map = new Map<number, Body>([[1, body()]]);
  let n = i;
  for (const [key, big] of map.entries()) {
    map.delete(key);
    n += size(big);
    await gate;
  }
  return n;
}
async function stringKeys(i: number): Promise<number> {
  const map = new Map<string, Body>();
  map.set("a", body());
  let n = i;
  for (const [key, big] of map) {
    map.delete(key);
    n += size(big);
    await gate;
  }
  return n;
}
async function set(i: number): Promise<number> {
  const bodies = new Set<Body>([body()]);
  let n = i;
  for (const big of bodies) {
    bodies.delete(big);
    n += size(big);
    await gate;
  }
  return n;
}
// This must keep the body.
async function readAgain(i: number): Promise<number> {
  const map = new Map<number, Body>([[1, body()]]);
  let n = i;
  for (const [key, big] of map) {
    map.delete(key);
    await gate;
    n += size(big);
  }
  return n;
}

// Starts 16 loops, lets each take its entry and wait for the gate, collects garbage and counts the bodies that are still alive.
// The collector scans the stack conservatively, so a stale word may keep one or two of them.
async function judge(name: string, start: (i: number) => Promise<number>): Promise<void> {
  watched = [];
  gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const running: Promise<number>[] = [];
  for (let i = 0; i < 16; i++) running.push(start(i));
  await turn();
  gc();
  let alive = 0;
  for (const each of watched) if (each.deref()) alive++;
  const verdict = alive <= 2 ? "collected" : alive === watched.length ? "kept" : alive + " of " + watched.length + " kept";
  open();
  let sum = 0;
  for (const each of running) sum += await each;
  console.log(name + ": " + verdict + ", " + sum);
}

await judge("a pattern", pattern);
await judge("the pair", pair);
await judge("entries()", entries);
await judge("string keys", stringKeys);
await judge("a set", set);
await judge("a value read after the await", readAgain);

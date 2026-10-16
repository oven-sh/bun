declare function gc(): void;

interface Body { bytes: number[] }

let watched: WeakRef<Body>[] = [];
let total = 0;

function body(): Body {
  const made: Body = { bytes: new Array<number>(32).fill(1) };
  watched.push(new WeakRef(made));
  return made;
}
function once(f: () => number): void {
  total += f();
}

function assignedInABranch(i: number) {
  let request: Body | undefined;
  if (i >= 0) request = body();
  let label = "n";
  label += i;
  once(() => request!.bytes.length);
  return () => label;
}
function aDefaultedParameter(i: number, request?: Body) {
  request = request ?? body();
  let label = "n";
  label += i;
  once(() => request!.bytes.length);
  return () => label;
}
function assignedInALoop(i: number) {
  let request = body();
  for (let k = 0; k < 2; k++) request = body();
  let count = 0;
  while (count < i) count++;
  once(() => request.bytes.length);
  return () => count;
}
function readByTheClosureThatStays(i: number) {
  let request: Body | undefined;
  if (i >= 0) request = body();
  let label = "n";
  label += i;
  once(() => request!.bytes.length);
  return () => label + request!.bytes.length;
}

async function judge(name: string, scenario: (i: number) => () => unknown) {
  watched = [];
  const kept: (() => unknown)[] = [];
  for (let i = 0; i < 16; i++) kept.push(scenario(i));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  gc();
  let alive = 0;
  for (const each of watched) if (each.deref() !== undefined) alive++;
  const verdict = alive * 4 <= watched.length ? "collected" : alive * 4 >= watched.length * 3 ? "kept" : alive + " of " + watched.length;
  console.log(name + ": " + verdict + ", " + kept.map(f => f()).join(" "));
}

await judge("assigned in a branch", assignedInABranch);
await judge("a defaulted parameter", aDefaultedParameter);
await judge("assigned in a loop", assignedInALoop);
await judge("read by the closure that stays", readByTheClosureThatStays);
console.log(total);

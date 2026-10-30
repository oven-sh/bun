// `if (flag) x = null` lets go of the object on that path, though `x` is read again behind the join.
// Prints what the compiler saves: objects that are collected earlier
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more = 0): void {
  sum += (thing?.payload.length ?? 0) + more;
}
const finalized = new Set<string>();
const registry = new FinalizationRegistry<string>(name => finalized.add(name));
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const lines: string[] = [];
const say = (form: string, gone: boolean) => lines.push(`${form}: ${gone ? "collected" : "KEPT"}`);

function inOneArm(flag: boolean): boolean {
  let x: Thing | null = make();
  const ref = new WeakRef(x);
  use(x);
  if (flag) x = null;
  else use(x, 2);
  Bun.gc(true);
  const gone = ref.deref() === undefined;
  use(x);
  return gone;
}
say("in the arm that runs", inOneArm(true));
console.log(lines.join("\n"));
console.log(sum > 0);

type Listener = (...args: unknown[]) => void;
const show = (x: unknown): string =>
  typeof x === "function" ? "fn" : Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "string" ? JSON.stringify(x) : String(x);
function all(list: readonly unknown[]): string {
  let text = list.length + ":";
  for (let i = 0; i < list.length; i++) text += (i in list ? show(list[i]) : "hole") + ",";
  return text;
}
function oneStore(fn: Listener, first: boolean): unknown[] {
  const made = new Array(2);
  made[first ? 0 : 1] = fn;
  return made;
}
function beyondTheLength(list: Listener[], fn: Listener, far: boolean): unknown[] {
  const made = new Array(1);
  made[0] = fn;
  made[1] = list[0];
  made[far ? 5 : 2] = fn;
  return made;
}
(globalThis as any).handedOut = [oneStore, beyondTheLength];
const [one, beyond] = (globalThis as any).handedOut as [typeof oneStore, typeof beyondTheLength];
const given = [() => {}, 1, 2.5, NaN, -0, "text", undefined, null, 3n, 2 ** 31] as unknown as Listener[];
for (let i = 0; i < given.length; i++)
  console.log(all(one(given[i]!, i % 2 === 0)), all(beyond([given[(i + 1) % given.length]!], given[i]!, i % 3 === 0)));
export {};

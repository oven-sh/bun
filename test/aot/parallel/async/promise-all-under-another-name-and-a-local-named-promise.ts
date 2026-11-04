// The built-in under another name, called on another receiver, and a local object named Promise with an `all` of its own: what is called goes by binding, never by the text.
const log: string[] = [];
async function load(x: number) {
  await null;
  return x;
}
const all = Promise.all;
class Tracked<T> extends Promise<T> {
  static made = 0;
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void) {
    super(executor);
    Tracked.made++;
  }
}
function underAnotherName(x: number) {
  return (all as any).call(Promise, [load(x), x]) as Promise<unknown[]>;
}
function onASubclass(x: number) {
  return Tracked.all([load(x), x]);
}
function onNothing(x: number) {
  try {
    return (all as any)([load(x), x]);
  } catch (e) {
    return Promise.resolve([(e as Error).name]);
  }
}
function localNamedPromise(x: number) {
  const Promise = { all: (list: unknown[]) => "local all of " + list.length };
  return Promise.all([load(x), x]);
}
async function deed(x: number) {
  const tracked = onASubclass(x);
  log.push(String(tracked instanceof Tracked), String(Tracked.made > 0));
  return [(await underAnotherName(x)).join(), (await tracked).join(), (await onNothing(x)).join(), localNamedPromise(x)].join(" | ");
}
console.log(await deed(1));
for (let i = 0; i < 3; i++) console.log(await deed(i));
console.log(log.join(" "));

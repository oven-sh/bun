// `f(make(), other())`: what make() returned waits in the caller while other() runs. Once f has set its parameter to null nothing names the object, and it is collected while f still runs.
// Prints what the compiler saves: objects that are collected earlier
// Alone: what is let go of goes by which bodies are copied into which, and that by all that the executable holds
// Todo on win32 x64: Not every time: row 3517: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more: number): void {
  sum += (thing?.payload.length ?? 0) + more;
}
function other(): number {
  sum += made;
  return sum & 1;
}
const lines: string[] = [];
const say = (form: string, gone: boolean) => lines.push(`${form}: ${gone ? "collected" : "KEPT"}`);

function first(x: Thing | null, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function second(more: number, x: Thing | null): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = null;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function toUndefined(x: Thing | undefined, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, 0);
  use(x, more);
  x = undefined;
  Bun.gc(true);
  return ref.deref() === undefined;
}
function both(x: Thing | null, y: Thing | null, more: number): boolean {
  const refs = [new WeakRef(x!), new WeakRef(y!)];
  use(x, more);
  use(y, more);
  x = null;
  y = null;
  Bun.gc(true);
  return refs.every(ref => ref.deref() === undefined);
}
class Holder {
  gone = false;
  constructor(x: Thing | null, more: number) {
    const ref = new WeakRef(x!);
    use(x, 0);
    use(x, more);
    x = null;
    Bun.gc(true);
    this.gone = ref.deref() === undefined;
  }
  method(x: Thing | null, more: number): boolean {
    const ref = new WeakRef(x!);
    use(x, 0);
    use(x, more);
    x = null;
    Bun.gc(true);
    return ref.deref() === undefined;
  }
}
function inFunction(): boolean {
  return first(make(), other());
}
function inFunctionThatGoesOn(): boolean {
  const gone = first(make(), other());
  use(null, other());
  return gone;
}
function inLoop(): boolean {
  let all = true;
  for (let i = 0; i < 3; i++) all = first(make(), other() + i) && all;
  return all;
}
function inTry(): boolean {
  try {
    return first(make(), other());
  } finally {
    use(null, other());
  }
}
function handsOn(x: Thing | null, more: number): boolean {
  return first(x, more + other());
}

say("at the top level", first(make(), 0));
say("at the top level, across a call", first(make(), other()));
say("the second parameter", second(other(), make()));
say("set to undefined", toUndefined(make(), other()));
say("two parameters", both(make(), make(), other()));
say("in a function", inFunction());
say("in a function that goes on", inFunctionThatGoesOn());
say("in a loop", inLoop());
say("in a try", inTry());
say("a constructor", new Holder(make(), other()).gone);
{
  const holder = new Holder(make(), 0);
  say("a method", holder.method(make(), other()));
}
say("call", first.call(undefined, make(), other()));
say("handed on", handsOn(make(), other()));
console.log(lines.join("\n"));
console.log(sum > 0);

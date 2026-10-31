// Closures that get members in the function that makes them, and sometimes nothing reads them. All of them must print what plain Bun prints.
const log: string[] = [];
function note(text: string): number {
  log.push(text);
  return log.length;
}

interface Listener {
  (value: number): number;
  queue: number[] | null;
  cancel: () => void;
}
function listen(queue: number[]): Listener {
  function done(value: number): number {
    return done.queue!.length + value;
  }
  function cancel(): void {
    done.queue = null;
  }
  done.queue = queue as number[] | null;
  done.cancel = cancel;
  return done;
}

// Nothing is left of the closures, and what is stored still runs.
function callAndCancel(queues: number[][], n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const done = listen(queues[i & 1]!);
    s += done(i & 3);
    done.cancel();
  }
  return s;
}
console.log("called and cancelled", callAndCancel([[1], [1, 2]], 10000));

// The values stored are worked out all the same.
function storesWhatIsWorkedOut(): number {
  function f(): void {}
  f.a = note("a");
  f.b = note("b");
  return log.length;
}
console.log("stored values", storesWhatIsWorkedOut(), log.join());

// The member is read through an alias, through the closure itself and by key.
function readsThroughAlias(x: number): number {
  function f(this: unknown): number {
    return (f as unknown as { v: number }).v;
  }
  const g = f as unknown as { v: number; w: number };
  g.v = x;
  g.w = x + 1;
  return f() + g.w;
}
console.log("alias", readsThroughAlias(3));
function readsByKey(key: string): unknown {
  function f(): void {}
  (f as unknown as Record<string, number>).p = 1;
  (f as unknown as Record<string, number>).q = 2;
  return (f as unknown as Record<string, unknown>)[key];
}
console.log("by key", readsByKey("p"), readsByKey("q"), readsByKey("r"), typeof readsByKey("name"), readsByKey("length"));

// Held by another: what the other shows is the closure.
function heldByOther(): unknown {
  function f(): void {}
  (f as unknown as { v: number }).v = 1;
  const g = () => f;
  return (g() as unknown as { v: number }).v;
}
console.log("held", heldByOther());
let kept: unknown;
function escapes(): void {
  function f(): void {}
  (f as unknown as { v: number }).v = 7;
  (f as unknown as { self: unknown }).self = f;
  kept = f;
}
escapes();
console.log("escapes", (kept as { v: number }).v, (kept as { self: unknown }).self === kept, Object.keys(kept as object).join());

// A store over a store: the first read finds the first value, the second read the second.
function storeOverStore(a: number, b: number): number[] {
  function f(): void {}
  const m = f as unknown as { v: number; w: number };
  m.v = a;
  m.w = b;
  const first = m.v;
  m.v = b;
  m.w = a;
  return [first, m.v, m.w];
}
console.log("over", storeOverStore(1, 2).join());
function twoClosuresOneMayBeOther(flag: boolean): number[] {
  function f(): void {}
  function g(): void {}
  const a = f as unknown as { v: number };
  const b = (flag ? f : g) as unknown as { v: number };
  a.v = 1;
  b.v = 2;
  return [a.v, b.v];
}
console.log("aliased", twoClosuresOneMayBeOther(true).join(), twoClosuresOneMayBeOther(false).join());

// Names a function has at birth, and what stands on the prototype.
function namesAtBirth(): unknown[] {
  function f(a: number, b: number): number {
    return a + b;
  }
  const m = f as unknown as Record<string, unknown>;
  const answers: unknown[] = [];
  try {
    m.name = "other";
  } catch (error) {
    answers.push(String(error));
  }
  try {
    m.length = 9;
  } catch (error) {
    answers.push(String(error));
  }
  m.prototype = null;
  m.call = 5;
  answers.push(f.name, f.length, f.prototype, m.call);
  return answers;
}
console.log("birth", namesAtBirth().join());

// A captured variable written by the closure that nothing reads.
function capturesWritten(): number {
  let count = 0;
  function up(): void {
    count++;
  }
  (up as unknown as { v: number }).v = 1;
  up();
  up();
  return count;
}
console.log("captured", capturesWritten());

// Made in a loop, one kept for later.
function oneKept(n: number): number {
  let last: { (): number; v: number } | undefined;
  for (let i = 0; i < n; i++) {
    const made = function (): number {
      return i;
    } as unknown as { (): number; v: number };
    made.v = i * 2;
    if (i === n - 2) last = made;
  }
  return last!() + last!.v;
}
console.log("kept", oneKept(10));

// An object in the environment and stored to as a member: its getter is not run.
let getterRuns = 0;
function objectHeld(): number {
  const holder = {
    get a(): number {
      getterRuns++;
      return 1;
    },
  };
  function f(): number {
    return holder.a;
  }
  (f as unknown as { holder: unknown }).holder = holder;
  return getterRuns;
}
console.log("held object", objectHeld(), getterRuns);

// A garbage collection in the middle.
function withCollection(): number {
  function f(): void {}
  const m = f as unknown as { v: object; w: number };
  m.v = {};
  Bun.gc(true);
  m.w = 1;
  return m.w;
}
console.log("collection", withCollection());

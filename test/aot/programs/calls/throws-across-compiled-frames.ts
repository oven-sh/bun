// A value thrown in one compiled function and caught in another arrives unchanged, and the catching function finds its local variables as they were.
const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
type Thrown = unknown;
const lines: string[] = [];
function say(what: string, value: unknown): void {
  lines.push(what + ": " + (typeof value === "symbol" ? value.toString() : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)));
}

function raise(value: Thrown): never {
  throw value;
}
function down(depth: number, value: Thrown): number {
  return depth ? down(depth - 1, value) + 1 : raise(value);
}

const sentinel = { name: "sentinel" };
const values: Thrown[] = [0, -0, NaN, 1.5, "", "text", true, false, null, undefined, 10n, Symbol("s"), sentinel, [1, 2], new RangeError("range"), () => 1];
for (const depth of [0, 1, 2, 10, 100]) {
  let same = 0;
  for (const value of values) {
    try {
      down(depth, value);
    } catch (caught) {
      if (Object.is(caught, value)) same++;
    }
  }
  say("depth " + depth, same + " of " + values.length);
}

function keepsManyLocals(seed: number, depth: number): number {
  let a = seed + 1, b = seed + 2, c = seed + 3, d = seed + 4, e = seed + 5, f = seed + 6, g = seed + 7, h = seed + 8;
  let x = seed + 0.5, y = seed + 1.5, z = seed + 2.5, w = seed + 3.5;
  const text = "s" + seed;
  const list = [seed];
  for (let i = 0; i < 3; i++) {
    try {
      a += down(depth + i, i);
    } catch (caught) {
      a += caught as number;
      b += a; c += b; d += c; e += d; f += e; g += f; h += g;
      x += y; y += z; z += w; w += x;
      list.push(a);
    }
  }
  return a + b + c + d + e + f + g + h + x + y + z + w + text.length + list.length;
}
function usesRegistersBetween(seed: number, depth: number): number {
  let a = seed * 3, b = seed * 5, c = seed * 7, d = seed * 11, e = seed * 13, f = seed * 17;
  const result = depth ? usesRegistersBetween(seed + 1, depth - 1) : raise(seed);
  return result + a + b + c + d + e + f;
}
say("locals", [keepsManyLocals(1, 0), keepsManyLocals(2, 5), keepsManyLocals(3, 40)]);
{
  let p = 1, q = 2, r = 3, s = 4, t = 5, u = 6;
  for (let i = 0; i < 4; i++) {
    try {
      usesRegistersBetween(i, i * 3);
    } catch (caught) {
      p += caught as number; q += p; r += q; s += r; t += s; u += t;
    }
  }
  say("registers of the frames between", [p, q, r, s, t, u]);
}

let order: string[] = [];
function withFinally(depth: number, value: Thrown): number {
  try {
    return depth ? withFinally(depth - 1, value) + 1 : raise(value);
  } finally {
    order.push("f" + depth);
  }
}
function rethrows(depth: number, value: Thrown): number {
  try {
    return depth ? rethrows(depth - 1, value) + 1 : raise(value);
  } catch (caught) {
    order.push("c" + depth);
    throw caught;
  }
}
function replaces(depth: number, value: Thrown): number {
  try {
    return depth ? replaces(depth - 1, value) + 1 : raise(value);
  } catch (caught) {
    throw [caught];
  }
}
for (const thrower of [withFinally, rethrows, replaces]) {
  order = [];
  try {
    thrower(3, sentinel);
  } catch (caught) {
    say(thrower.name, [caught === sentinel, caught, order]);
  }
}
function mixed(depth: number, value: Thrown): number {
  if (depth % 3 === 0) {
    try {
      return depth ? mixed(depth - 1, value) + 1 : raise(value);
    } finally {
      order.push("f" + depth);
    }
  }
  if (depth % 3 === 1) {
    try {
      return mixed(depth - 1, value) + 1;
    } catch (caught) {
      order.push("c" + depth);
      throw caught;
    }
  }
  return mixed(depth - 1, value) + 1;
}
order = [];
try {
  mixed(8, 7);
} catch (caught) {
  say("finally, catch and plain frames", [caught, order]);
}

function catchesSome(depth: number, value: Thrown): Thrown {
  try {
    return down(depth, value);
  } catch (caught) {
    if (typeof caught === "number") return "number " + caught;
    throw caught;
  }
}
try {
  say("filtered", catchesSome(2, 5));
  catchesSome(2, "passes");
} catch (caught) {
  say("filtered on", caught);
}

function throwsInCatch(): string {
  try {
    try {
      down(2, "first");
    } catch (caught) {
      down(3, caught + ", second");
    }
  } catch (caught) {
    return caught as string;
  }
  return "nothing";
}
function throwsInFinally(): string {
  try {
    try {
      down(2, "first");
    } finally {
      down(1, "from finally");
    }
  } catch (caught) {
    return caught as string;
  }
  return "nothing";
}
say("a throw in a catch block", throwsInCatch());
say("a throw in a finally block", throwsInFinally());

class Account {
  balance = 10;
  get overdrawn(): boolean {
    return raise("getter");
  }
  set limit(value: number) {
    raise("setter " + value);
  }
  constructor(fails: boolean) {
    if (fails) down(2, "constructor");
  }
  static create(): Account {
    return new Account(true);
  }
  withdraw(amount: number): number {
    if (amount > this.balance) raise({ short: amount - this.balance });
    return (this.balance -= amount);
  }
}
const account = new Account(false);
for (const attempt of [() => account.overdrawn, () => (account.limit = 3), () => Account.create(), () => account.withdraw(25), () => account.withdraw(4)]) {
  try {
    say("returned", attempt());
  } catch (caught) {
    say("members", caught);
  }
}

function throughCallbacks(value: Thrown): Thrown {
  try {
    [1, 2, 3].forEach(item => {
      [item].map(inner => {
        if (inner === 2) down(2, value);
        return inner;
      });
    });
  } catch (caught) {
    return caught;
  }
  return "nothing";
}
say("through built-in callbacks", throughCallbacks(sentinel) === sentinel);
say("through sort", (() => { try { return [3, 1, 2].sort((a, b) => raise("comparator " + typeof a + typeof b)); } catch (caught) { return caught; } })());
say("through JSON", (() => { try { return JSON.stringify({ toJSON() { return down(1, "toJSON"); } }); } catch (caught) { return caught; } })());
say("through replace", (() => { try { return "abc".replace(/b/, () => raise("replacer")); } catch (caught) { return caught; } })());

function* numbers(value: Thrown): Generator<number, void, unknown> {
  try {
    yield 1;
    down(2, value);
    yield 2;
  } finally {
    order.push("generator closed");
  }
}
order = [];
try {
  for (const n of numbers("from a generator")) order.push("n" + n);
} catch (caught) {
  say("generator", [caught, order]);
}
{
  const generator = numbers(0);
  generator.next();
  try {
    generator.throw("injected");
  } catch (caught) {
    say("generator.throw", caught);
  }
}

const tick = Promise.resolve();
async function asyncDown(depth: number, value: Thrown, waits: boolean): Promise<number> {
  if (depth) return (await asyncDown(depth - 1, value, waits)) + 1;
  if (waits) await tick;
  return down(2, value);
}
async function asyncFinally(value: Thrown): Promise<number> {
  try {
    return await asyncDown(2, value, true);
  } finally {
    await tick;
    order.push("async finally");
  }
}
async function main(): Promise<void> {
  for (const waits of [false, true]) {
    let same = 0;
    for (const value of values) {
      try {
        await asyncDown(3, value, waits);
      } catch (caught) {
        if (Object.is(caught, value)) same++;
      }
    }
    say("async, " + (waits ? "after an await" : "before any await"), same + " of " + values.length);
  }
  order = [];
  try {
    await asyncFinally(sentinel);
  } catch (caught) {
    say("async finally", [caught === sentinel, order]);
  }
  say("rejection handler", await asyncDown(1, "rejected", true).catch(reason => "handled " + reason));
  say("all settled", (await Promise.allSettled([asyncDown(0, 1, true), asyncDown(1, 2, false), Promise.resolve(3)])).map(result => (result.status === "rejected" ? "r" + result.reason : "f" + result.value)));
  let total = 0;
  for (let i = 0; i < 20000; i++) {
    try {
      total += down(i % 7, i);
    } catch (caught) {
      total += caught as number;
    }
    if (i % 5000 === 0) collect(true);
  }
  say("many throws", total);
  const kept: object[] = [];
  for (let i = 0; i < 2000; i++) {
    try {
      down(3, { index: i, filler: "x".repeat(i % 50) });
    } catch (caught) {
      if (i % 100 === 0) kept.push(caught as object);
    }
  }
  collect(true);
  say("fresh objects", kept.length + " " + JSON.stringify(kept[7]));
  console.log(lines.join("\n"));
}
main();

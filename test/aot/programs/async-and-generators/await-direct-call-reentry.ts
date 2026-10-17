// One async function is at once awaited by name, kept as a promise, passed as a value, called again while an earlier call is suspended, called recursively, and called from plain functions, methods, getters and callbacks.
const log: string[] = [];
const settled = Promise.resolve(0);
const collect: (sync?: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
let gate: (() => void)[] = [];
function wait(): Promise<void> {
  return new Promise<void>(resolve => gate.push(resolve));
}
function open(): void {
  const waiting = gate;
  gate = [];
  for (const resolve of waiting) resolve();
}

async function shared(name: string, turns: number): Promise<string> {
  log.push(name + " enters");
  for (let i = 0; i < turns; i++) {
    await wait();
    log.push(name + " turn " + i);
  }
  return name + " done";
}
async function awaitsShared(name: string, turns: number): Promise<string> {
  const value = await shared(name, turns);
  log.push(name + " is back");
  return value.toUpperCase();
}
async function fibonacci(n: number): Promise<number> {
  if (n < 2) return n;
  return (await fibonacci(n - 1)) + (await fibonacci(n - 2));
}
async function countsDown(n: number): Promise<number> {
  if (!n) return 0;
  if (n % 3 === 0) await settled;
  return 1 + (await countsDown(n - 1));
}
async function even(n: number): Promise<boolean> {
  return n === 0 ? true : await odd(n - 1);
}
async function odd(n: number): Promise<boolean> {
  if (n === 0) return false;
  await settled;
  return await even(n - 1);
}
class Store {
  #items = new Map<string, { name: string; size: number }>();
  calls = 0;
  async find(name: string): Promise<{ name: string; size: number } | undefined> {
    this.calls++;
    if (name.length > 3) await settled;
    return this.#items.get(name);
  }
  async #insert(name: string): Promise<{ name: string; size: number }> {
    const item = { name, size: name.length };
    this.#items.set(name, item);
    return item;
  }
  async findOrInsert(name: string): Promise<{ name: string; size: number }> {
    return (await this.find(name)) ?? (await this.#insert(name));
  }
  static async make(names: string[]): Promise<Store> {
    const store = new Store();
    for (const name of names) await store.findOrInsert(name);
    return store;
  }
  get first(): Promise<{ name: string; size: number } | undefined> {
    return this.find("a");
  }
}
class LoudStore extends Store {
  async find(name: string): Promise<{ name: string; size: number } | undefined> {
    log.push("LoudStore.find " + name);
    return await super.find(name);
  }
}
async function holdsGarbage(n: number): Promise<number> {
  const held = { list: Array.from({ length: 50 }, (_, i) => ({ i, text: "item " + i + " of " + n })) };
  await wait();
  collect(true);
  const sum = await sumsAfterCollection(held.list.map(item => item.i));
  collect(true);
  return sum + held.list[n].text.length;
}
async function sumsAfterCollection(list: number[]): Promise<number> {
  const copy = list.map(x => ({ x }));
  await wait();
  collect(true);
  let sum = 0;
  for (const { x } of copy) sum += x;
  return sum;
}
function plainCaller(name: string): Promise<string> {
  return shared(name, 1);
}

async function main(): Promise<void> {
  const kept = shared("kept", 2);
  const awaited = awaitsShared("awaited", 3);
  const byValue = [shared, awaitsShared].map((f, i) => f("by value " + i, i + 1));
  const plain = plainCaller("plain");
  const bound = shared.bind(null, "bound")(1);
  const applied = shared.apply(null, ["applied", 0]);
  log.push("same promise " + (kept === Promise.resolve(kept)) + " " + (kept instanceof Promise));
  for (let i = 0; i < 5; i++) {
    open();
    await settled;
    await settled;
    await settled;
    log.push("round " + i);
  }
  log.push([await kept, await awaited, ...(await Promise.all(byValue)), await plain, await bound, await applied].join(" | "));
  log.push("fibonacci " + (await fibonacci(12)));
  log.push("countsDown " + (await countsDown(500)));
  log.push("even " + (await even(21)) + " " + (await odd(21)));
  const store = await Store.make(["a", "bb", "cccc", "a", "ddddd", "cccc"]);
  log.push("store " + store.calls + " " + JSON.stringify(await store.first) + " " + JSON.stringify(await store.find("cccc")) + " " + JSON.stringify(await store.find("none")));
  const loud: Store = new LoudStore();
  log.push("loud " + JSON.stringify(await loud.findOrInsert("eeee")) + " " + JSON.stringify(await loud.findOrInsert("eeee")));
  const garbage = [holdsGarbage(3), holdsGarbage(7)];
  for (let i = 0; i < 4; i++) {
    open();
    collect(true);
    await settled;
    await settled;
    await settled;
  }
  log.push("garbage " + (await garbage[0]) + " " + (await garbage[1]));
  const many: Promise<number>[] = [];
  for (let i = 0; i < 200; i++) many.push(countsDown(i % 17));
  log.push("many " + (await Promise.all(many)).reduce((a, b) => a + b, 0));
}

main().then(() => {
  for (const line of log) console.log(line);
});

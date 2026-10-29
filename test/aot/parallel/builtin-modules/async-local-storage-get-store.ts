// AsyncLocalStorage.getStore() in every situation that decides what it answers: no context, its own frame on top or below others, default values, enterWith, exit, disable, awaits and timers, subclasses, objects that only have a method of that name, and a getStore that the program replaces, shadows, deletes or borrows.
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

const lines: string[] = [];
const say = (...parts: unknown[]) => lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
const first = new AsyncLocalStorage<{ id: number }>();
const second = new AsyncLocalStorage<string>();
const third = new AsyncLocalStorage<number>();
const withDefault = new AsyncLocalStorage<string>({ defaultValue: "default", name: "named" } as any);

const where = (error: unknown, frames: number) => (error as Error).stack!.split("\n").slice(1, 1 + frames).map(line => /at (?:(\S+) \()?.*?:(\d+):\d+\)?$/.exec(line.trim())).map(found => (found ? (found[1] ?? "") + ":" + found[2] : "?")).join(" < ");
function read(storage: any): unknown {
  return storage.getStore();
}
function all(): string {
  return [read(first), read(second), read(third), read(withDefault)].map(value => JSON.stringify(value) ?? "undefined").join(" ");
}
for (let round = 0; round < 300; round++) all();

say("outside", all());
first.run({ id: 1 }, () => {
  say("first", all());
  second.run("two", () => {
    say("first second", all());
    third.run(3, () => {
      say("first second third", all());
      first.run({ id: 4 }, () => say("first again", all()));
      say("back", all());
      second.exit(() => say("second left", all()));
      withDefault.run("given", () => say("default replaced", all()));
      withDefault.run(undefined as any, () => say("default replaced by undefined", all()));
    });
  });
  say("first alone", all());
});
say("outside again", all());

first.run({ id: 5 }, () => {
  let total = 0;
  for (let round = 0; round < 2000; round++) total += first.getStore()!.id + (second.getStore() === undefined ? 1 : 0);
  say("in a loop", total);
});

second.run("masked", () => {
  third.run(7, () => {
    second.disable();
    say("second disabled", all());
    third.run(8, () => say("below a mask", all()));
  });
  say("behind the disabling", all());
});
say("outside after disable", all());
second.run("enabled again", () => say("second runs again", all()));

third.enterWith(9);
say("entered", all());
third.enterWith(10);
say("entered again", all());
first.run({ id: 6 }, () => say("run on top of enterWith", all()));
third.disable();
say("left", all());

class Heir extends AsyncLocalStorage<string> {
  override getStore(): string {
    return "heir of " + super.getStore();
  }
}
class PlainHeir extends AsyncLocalStorage<string> {}
const heir = new Heir();
const plainHeir = new PlainHeir();
heir.run("a", () => plainHeir.run("b", () => say("heirs", read(heir), read(plainHeir), all())));

const lookalikes = [{ getStore: () => "a literal" }, new (class { getStore() { return "a class"; } })(), Object.create({ getStore() { return "inherited"; } }), Object.assign(() => 0, { getStore: () => "a function" })];
for (const lookalike of lookalikes) say("lookalike", read(lookalike));
for (const nothing of [undefined, null, 1, "text", {}, { getStore: 1 }]) {
  try {
    say("no storage", read(nothing));
  } catch (error) {
    say("no storage", (error as Error).constructor.name, where(error, 2));
  }
}
function throwing(this: unknown): never {
  throw new Error("thrown by getStore");
}
function readInTry(storage: any): unknown {
  try {
    return storage.getStore();
  } catch (error) {
    return (error as Error).constructor.name + " " + where(error, 3);
  }
}
say("it throws", readInTry({ getStore: throwing }), "|", readInTry(first), "|", readInTry(null));

const shadowed = new AsyncLocalStorage<number>();
shadowed.run(1, () => {
  say("before the shadow", read(shadowed));
  (shadowed as { getStore: unknown }).getStore = () => "own";
  say("own property", read(shadowed));
  delete (shadowed as { getStore?: unknown }).getStore;
  say("own property deleted", read(shadowed));
  (shadowed as unknown as { extra: number }).extra = 1;
  say("another property", read(shadowed));
  Object.setPrototypeOf(shadowed, { getStore: () => "another prototype" });
  say("another prototype", read(shadowed));
  Object.setPrototypeOf(shadowed, AsyncLocalStorage.prototype);
  say("the prototype again", read(shadowed));
});

const borrowed = { getStore: AsyncLocalStorage.prototype.getStore };
try {
  say("borrowed", first.run({ id: 7 }, () => read(borrowed)));
} catch (error) {
  say("borrowed", (error as Error).constructor.name);
}
say("called on another storage", first.run({ id: 8 }, () => second.run("x", () => AsyncLocalStorage.prototype.getStore.call(first))));

async function later(): Promise<void> {
  await first.run({ id: 11 }, async () => {
    say("before await", all());
    await null;
    say("after await", all());
    await new Promise<void>(resolve => setTimeout(resolve, 1));
    say("after a timer", all());
    await Promise.all([second.run("left", async () => { await null; say("left", all()); }), second.run("right", async () => { await null; say("right", all()); })]);
    const snapshot = AsyncLocalStorage.snapshot();
    const bound = AsyncLocalStorage.bind(all);
    const resource = new AsyncResource("test");
    queueMicrotask(() => say("in a microtask", all()));
    process.nextTick(() => say("in a tick", all()));
    setTimeout(() => say("kept", snapshot(all), "|", bound(), "|", resource.runInAsyncScope(all)), 1);
  });
  say("outside the async run", all());
  await new Promise<void>(resolve => setTimeout(resolve, 10));
}
await later();

const original = AsyncLocalStorage.prototype.getStore;
first.run({ id: 12 }, () => {
  say("before it is replaced", all());
  AsyncLocalStorage.prototype.getStore = function (this: AsyncLocalStorage<unknown>) {
    return ["replaced", original.call(this)];
  };
  say("replaced", all());
  for (let round = 0; round < 300; round++) all();
  AsyncLocalStorage.prototype.getStore = original;
  say("put back", all());
  let asked = 0;
  Object.defineProperty(AsyncLocalStorage.prototype, "getStore", { get() { asked++; return original; }, configurable: true });
  say("an accessor", all(), asked);
  delete (AsyncLocalStorage.prototype as { getStore?: unknown }).getStore;
  try {
    say("deleted", all());
  } catch (error) {
    say("deleted", (error as Error).constructor.name);
  }
  Object.defineProperty(AsyncLocalStorage.prototype, "getStore", { value: original, writable: true, configurable: true, enumerable: false });
  say("defined anew", all(), read(new AsyncLocalStorage()));
});
console.log(lines.join("\n"));

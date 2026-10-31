// `await generator.next()` goes on in its turn among the other jobs, whether the step is finished at once, behind other jobs, behind an await in the body, by a throw or by the end of the body.
// No store is made, so no async context is tracked: the same steps as in awaited-steps-under-stores-that-wait-or-do-not.ts go other ways.
class NoStore<T> { getStore(): T | undefined { return undefined; } run<R>(_: T, call: () => R): R { return call(); } enterWith(_: T) {} }
const store = new NoStore<string>();
const lines: string[] = [];
const seen = (where: string) => void lines.push(where + " | " + String(store.getStore()));
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
let release: ((value: number) => void) | undefined;
const gate = () => new Promise<number>(resolve => (release = resolve));

async function* atOnce(name: string) {
  for (let i = 0; i < 3; i++) { seen(name + " body " + i); yield i; }
  return "end of " + name;
}
async function* waits(name: string) {
  for (let i = 0; i < 2; i++) { seen(name + " before"); await tick(); seen(name + " behind"); yield i; }
}
async function* gated(name: string) {
  seen(name + " before the gate");
  const value = await gate();
  seen(name + " behind the gate");
  yield value;
  seen(name + " goes on");
}
async function* throwsAtOnce(name: string): AsyncGenerator<number> {
  yield 1;
  seen(name + " throws");
  throw new Error("thrown by " + name);
}
async function* throwsLater(name: string): AsyncGenerator<number> {
  await tick();
  seen(name + " throws later");
  throw new Error("thrown later by " + name);
}
async function* enters(name: string) {
  yield 1;
  store.enterWith("entered by " + name);
  seen(name + " entered");
  yield 2;
  await tick();
  seen(name + " behind its wait");
  yield 3;
}
async function* yieldsPromises(name: string) {
  yield Promise.resolve(name + " 1");
  yield store.run("inside " + name, () => tick().then(() => name + " 2"));
  yield { then(resolve: (value: string) => void) { seen(name + " then"); resolve(name + " 3"); } } as unknown as string;
}

async function byHand<T>(name: string, generator: AsyncGenerator<T, unknown, unknown>, steps: number) {
  for (let i = 0; i < steps; i++) {
    try {
      const step = await generator.next();
      seen(name + " got " + JSON.stringify(step.value) + " " + step.done);
    } catch (error) {
      seen(name + " caught " + (error as Error).message);
    }
  }
}
async function* byHandInGenerator<T>(name: string, generator: AsyncGenerator<T, unknown, unknown>, steps: number) {
  for (let i = 0; i < steps; i++) {
    const step = await generator.next();
    seen(name + " got " + JSON.stringify(step.value) + " " + step.done);
    yield step.value;
  }
}
async function busy(name: string, turns: number) {
  for (let i = 0; i < turns; i++) { await null; seen(name + " turn " + i); }
}

async function main() {
  await store.run("a", () => byHand("at once", atOnce("g1"), 5));
  await Promise.all([store.run("b", () => byHand("among jobs", atOnce("g2"), 5)), store.run("other", () => busy("busy", 6))]);
  await store.run("c", () => byHand("waits", waits("g3"), 3));
  const shared = waits("g4");
  await Promise.all([store.run("d1", () => byHand("first of two", shared, 2)), store.run("d2", () => byHand("second of two", shared, 2))]);
  const waiting = store.run("e", () => byHand("gated", gated("g5"), 2));
  await tick();
  store.run("opener", () => release!(7));
  await waiting;
  await store.run("f", () => byHand("throws", throwsAtOnce("g6"), 3));
  await store.run("g", () => byHand("throws later", throwsLater("g7"), 2));
  await store.run("h", () => byHand("enters", enters("g8"), 4));
  seen("behind enters");
  await store.run("i", () => byHand("promises", yieldsPromises("g9"), 4));
  await store.run("j", async () => { for await (const value of byHandInGenerator("in a generator", waits("g10"), 2)) seen("loop got " + value); });
  await store.run("k", () => byHand("over one that steps by hand", byHandInGenerator("inner", atOnce("g11"), 2), 3));

  // The body starts loops over its own generator and ends: their requests wait behind the one that is being answered, and the end of the body answers them all.
  for (const end of ["throws", "returns", "falls off"]) {
    for (const consumer of ["function", "generator"]) {
      for (const loops of [1, 2]) {
        const name = end + ", " + consumer + ", " + loops;
        let self: AsyncGenerator<number, unknown, unknown> | undefined;
        const started: Promise<void>[] = [];
        const loop = async (which: number) => {
          try { for await (const value of self!) seen(name + ": loop " + which + " got " + value); seen(name + ": loop " + which + " ends"); } catch (error) { seen(name + ": loop " + which + " caught " + (error as Error).message); }
        };
        const byCall = async () => { const step = await self!.next(); seen(name + ": a call got " + JSON.stringify(step.value) + " " + step.done); };
        self = (async function* (): AsyncGenerator<number, unknown, unknown> {
          yield 1;
          for (let which = 0; which < loops; which++) started.push(store.run("loop " + which, () => loop(which)));
          started.push(store.run("call", byCall));
          seen(name + ": started");
          if (end === "throws") throw new Error("the end of " + name);
          if (end === "returns") return "returned by " + name;
        })();
        if (consumer === "function") await store.run("l", () => byHand(name, self!, 3));
        else await store.run("l", async () => { try { for await (const value of byHandInGenerator(name, self!, 3)) seen(name + ": outer got " + JSON.stringify(value)); } catch (error) { seen(name + ": outer caught " + (error as Error).message); } });
        await Promise.all(started);
      }
    }
  }
  seen("end");
}
main().then(() => console.log(lines.join("\n")));

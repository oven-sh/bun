import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

// The promises are counted a list of free cells at a time, and the last list is lost: a block, which is 64 KB on some targets.
const turns = 60_000;
const files = {
  "main.mjs": `
    import { AsyncLocalStorage } from "node:async_hooks";
    const turns = ${turns};
    let resolveNext = () => {};
    function pending() {
      return new Promise(resolve => {
        resolveNext = resolve;
      });
    }
    async function awaitPromises(hasOtherReaction) {
      let sum = 0;
      for (let i = 0; i < turns; i++) {
        const promise = pending();
        if (hasOtherReaction) promise.then(value => (sum += value));
        sum += await promise;
      }
      return sum;
    }
    async function leaf(gate) {
      return (await gate) + 1;
    }
    async function awaitCalls() {
      let sum = 0;
      for (let i = 0; i < turns; i++) sum += await leaf(pending());
      return sum;
    }
    function drive(done) {
      let finished = false;
      done.then(() => (finished = true));
      return new Promise(resolve => {
        const step = () => {
          if (finished) return resolve(done);
          resolveNext(1);
          setImmediate(step);
        };
        step();
      });
    }
    const cases = {
      pendingPromises: () => drive(awaitPromises(false)),
      suspendedCalls: () => drive(awaitCalls()),
      promisesWithOtherReaction: () => drive(awaitPromises(true)),
      asyncContext: () => new AsyncLocalStorage().run(7, () => drive(awaitPromises(false))),
    };
    console.log(await cases[process.argv[2]]());
  `,
};

const firstSuspensions = ["operationAOTSaveFrameAndAwait", "operationAOTSaveFrameAndAwaitCall"];
const laterSuspensions = ["operationAOTAwaitWithSavedFrame", "operationAOTAwaitCallWithSavedFrame"];

test("an await after the first suspension registers its waiter without a call into the run time", async () => {
  using dir = tempDir("aot-later-awaits", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (name: string) => {
    const path = join(String(dir), "counts-" + name);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    const interpreted = await run([bunExe(), "main.mjs", name], String(dir), bunEnv);
    expect(await run([executable, name], String(dir), env)).toEqual({
      stdout: interpreted.stdout,
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = Object.fromEntries(
      [...firstSuspensions, ...laterSuspensions].map(operation => [operation, 0]),
    );
    let promises = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, operation] = line.split("\toperation:");
      if (operation !== undefined && operation in counts) counts[operation] = Number(count);
      promises += Number(/^refill \S+ \S+ JSPromise:\d+ (\d+) \d+$/.exec(line)?.[1] ?? 0);
    }
    const later = laterSuspensions.reduce((sum, operation) => sum + counts[operation]!, 0);
    return { counts, promises, later: later < turns / 20 ? "few" : later > turns * 0.9 ? "every turn" : later };
  };

  const pendingPromises = await counted("pendingPromises");
  const suspendedCalls = await counted("suspendedCalls");
  // A function suspends a first time through an operation. A renamed operation would count none.
  expect(pendingPromises.counts.operationAOTSaveFrameAndAwait).toBeGreaterThan(0);
  // Both make the promise of pending() each turn. A call that returns a promise after all would make one more.
  expect(pendingPromises.promises).toBeGreaterThan(turns * 0.9);
  expect(suspendedCalls.promises).toBeLessThan(pendingPromises.promises * 1.25);
  expect({ pendingPromises: pendingPromises.later, suspendedCalls: suspendedCalls.later }).toEqual({
    pendingPromises: "few",
    suspendedCalls: "few",
  });

  const promisesWithOtherReaction = await counted("promisesWithOtherReaction");
  const asyncContext = await counted("asyncContext");
  expect({ promisesWithOtherReaction: promisesWithOtherReaction.later, asyncContext: asyncContext.later }).toEqual({
    promisesWithOtherReaction: "every turn",
    asyncContext: "few",
  });
}, 240_000);

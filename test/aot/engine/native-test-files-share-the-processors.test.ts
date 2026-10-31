// CI runs up to four test files at once. Each native-<n>.test.ts starts one `testaot` for each processor, so three of them side by
// side had three for each processor. On the Intel Macs, where a start of a process with a new image costs the most, tests that
// start the shell twenty times then printed nothing for 100 seconds and were ended as hung.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sharedSlot } from "../harness/shared-slots";

const worker = `
import { appendFileSync, readFileSync } from "node:fs";
import { sharedSlot } from ${JSON.stringify(join(import.meta.dir, "..", "harness", "shared-slots.ts"))};
const [slots, count, pieces, log, arrived, processes] = process.argv.slice(2);

if (!log) {
  await sharedSlot(slots, Number(count), async () => {
    console.log("taken");
    await new Promise(() => setInterval(() => {}, 1000));
  });
}

// Nobody begins before everybody is there.
appendFileSync(arrived, ".");
while (readFileSync(arrived, "utf8").length < Number(processes)) await Bun.sleep(5);

await Promise.all(
  Array.from({ length: Number(pieces) }, () =>
    sharedSlot(slots, Number(count), async () => {
      appendFileSync(log, "+");
      await Bun.sleep(30);
      appendFileSync(log, "-");
    }),
  ),
);
`;

test("three files that run at once have no more under way together than one of them alone", async () => {
  using dir = tempDir("native-test-files-share-the-processors", { "worker.ts": worker });
  const [slots, log, arrived] = ["slots", "log", "arrived"].map(name => join(String(dir), name));
  const exitCodes = await Promise.all(
    [1, 2, 3].map(async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "worker.ts"), slots, "4", "8", log, arrived, "3"],
        env: bunEnv,
        stdio: ["ignore", "inherit", "inherit"],
      });
      return await child.exited;
    }),
  );
  expect(exitCodes).toEqual([0, 0, 0]);

  let underWay = 0;
  let most = 0;
  const marks = readFileSync(log, "utf8");
  for (const mark of marks) most = Math.max(most, (underWay += mark === "+" ? 1 : -1));
  expect({ begun: marks.replaceAll("-", "").length, stillUnderWay: underWay }).toEqual({ begun: 24, stillUnderWay: 0 });
  expect(most).toBeLessThanOrEqual(4);
}, 120_000);

test("a file that runs alone gets every slot", async () => {
  using dir = tempDir("native-test-files-share-the-processors", {});
  const everyoneBegan = Promise.withResolvers<void>();
  let begun = 0;
  await Promise.all(
    Array.from({ length: 4 }, () =>
      sharedSlot(join(String(dir), "slots"), 4, async () => {
        if (++begun === 4) everyoneBegan.resolve();
        await everyoneBegan.promise;
      }),
    ),
  );
  expect(begun).toBe(4);
}, 120_000);

test("the slot of a file that was killed is taken again", async () => {
  using dir = tempDir("native-test-files-share-the-processors", { "worker.ts": worker });
  const slots = join(String(dir), "slots");
  {
    await using holder = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "worker.ts"), slots, "1", "1"],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
    });
    for await (const chunk of holder.stdout) if (new TextDecoder().decode(chunk).includes("taken")) break;
    holder.kill("SIGKILL");
    await holder.exited;
  }
  let ran = false;
  await sharedSlot(slots, 1, async () => void (ran = true));
  expect(ran).toBe(true);
}, 120_000);

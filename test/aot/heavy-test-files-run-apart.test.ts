import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Each test file says when it starts and ends. The lines come in the order of the events.
const fileThatTakes = (name: string, milliseconds: number, before = "") => `
  import { test } from "bun:test";
  import { appendFileSync } from "node:fs";
  test("${name}", async () => {
    appendFileSync(process.env.TRAIL, "start ${name}\\n");
    ${before}
    await Bun.sleep(${milliseconds});
    appendFileSync(process.env.TRAIL, "end ${name}\\n");
  });`;

const startOf = (code: string) => `Bun.spawnSync([process.execPath, "-e", ${JSON.stringify(code)}]);`;

type Measured = { milliseconds: number; megabytes?: number };

async function trailOf(records: { [name: string]: Measured }, words: string, ...flags: string[]) {
  const names = Object.keys(records);
  const table = (of: (record: Measured) => number | undefined) =>
    Object.fromEntries(
      names.flatMap(name => (of(records[name]) === undefined ? [] : [[`${name}.test.js`, of(records[name])]])),
    );
  using dir = tempDir("heavy-test-files-run-apart", {
    ...Object.fromEntries(names.map(name => [`${name}.test.js`, fileThatTakes(name, records[name].milliseconds)])),
    "timings.json": JSON.stringify({
      version: 1,
      files: table(it => it.milliseconds),
      memory: table(it => it.megabytes),
    }),
  });
  const trail = join(String(dir), "trail.txt");
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot", "--isolate", "--timings=timings.json", ...flags, "."],
    String(dir),
    { ...bunEnv, TRAIL: trail, BUN_DEBUG_TEST_AOT_WORDS: words },
  );
  expect({ exitCode, passed: stderr.match(/^\s*(\d+) pass$/m)?.[1] }).toEqual({
    exitCode: 0,
    passed: String(names.length),
  });
  return readFileSync(trail, "utf8").trim().split("\n");
}

function mostAtOnce(trail: string[], isCounted: (name: string) => boolean) {
  let [now, most] = [0, 0];
  for (const line of trail) {
    const [event, name] = line.split(" ");
    if (isCounted(name)) most = Math.max(most, (now += event === "start" ? 1 : -1));
  }
  return most;
}

test.each([
  ["one program", "TestRunLayers:0"],
  ["two layers", "TestRunLayers:2"],
])(
  "files that took over a gigabyte run at once only where they took no more together than the largest alone: %s",
  async (_, words) => {
    const records: { [name: string]: Measured } = { largest: { milliseconds: 300, megabytes: 3000 } };
    for (let k = 0; k < 4; k++) records[`half${k}`] = { milliseconds: 500, megabytes: 1400 };
    // Files without a record, and files that took a gigabyte or less, run at once as before.
    for (let k = 0; k < 4; k++) records[`slow${k}`] = { milliseconds: 600, megabytes: k < 2 ? 1024 : undefined };
    for (let k = 0; k < 10; k++) records[`light${k}`] = { milliseconds: 40, megabytes: 20 + k };
    const trail = await trailOf(records, words, "--parallel=6");
    let [now, most] = [0, 0];
    for (const line of trail) {
      const [event, name] = line.split(" ");
      const megabytes = (records[name].megabytes ?? 0) > 1024 ? records[name].megabytes! : 0;
      most = Math.max(most, (now += event === "start" ? megabytes : -megabytes));
    }
    expect(most).toBe(3000);
    expect(mostAtOnce(trail, name => name.startsWith("half"))).toBe(2);
    expect(mostAtOnce(trail, name => name.startsWith("slow"))).toBeGreaterThan(1);
  },
);

test("as long as a heavy file is left, the others get what fits beside it", async () => {
  // By time alone the order is a, heavy, b, c, d, e. Two workers: beside the heavy file there is room for one average file, 861 MB.
  const trail = await trailOf(
    {
      a: { milliseconds: 1600, megabytes: 900 },
      heavy: { milliseconds: 1500, megabytes: 3000 },
      b: { milliseconds: 90, megabytes: 862 },
      c: { milliseconds: 80, megabytes: 400 },
      d: { milliseconds: 70 },
      e: { milliseconds: 60, megabytes: 5 },
    },
    "TestRunLayers:0",
    "--parallel=2",
  );
  // The heavy file begins first, so that nothing large is begun ahead of it. A file without a record counts as light. What fits goes
  // by time, and of what does not fit the lightest goes first.
  expect(trail.filter(line => line.startsWith("start"))).toEqual([
    "start heavy",
    "start c",
    "start d",
    "start e",
    "start b",
    "start a",
  ]);
});

test.skipIf(!isLinux)("a compiled run writes by how much each file's worker grew", async () => {
  using dir = tempDir("heavy-test-files-are-measured", {
    "grows.test.js": fileThatTakes("grows", 1, "globalThis.kept = Buffer.alloc(300 << 20, 1);"),
    "small.test.js": fileThatTakes("small", 1),
    // What a test starts as a process of its own counts like what it does itself, whoever waits for it.
    "starts-large.test.js": fileThatTakes("starts-large", 1, startOf("Buffer.alloc(700 << 20, 1)")),
    "starts-one-that-starts-large.test.js": fileThatTakes(
      "starts-one-that-starts-large",
      1,
      startOf(`Bun.spawnSync([process.execPath, "-e", "Buffer.alloc(700 << 20, 1)"])`),
    ),
    // Those that run at once count together, also where each stays smaller than the worker.
    "grows-and-starts-four-at-once.test.js": fileThatTakes(
      "grows-and-starts-four-at-once",
      1,
      // Each says when it holds its memory, and none ends before all have held theirs for a second, however busy the machine is.
      `globalThis.kept = Buffer.alloc(300 << 20, 1);
       const { existsSync, writeFileSync } = require("node:fs");
       const code = \`globalThis.kept = Buffer.alloc(150 << 20, 1);
         require("node:fs").writeFileSync(process.env.HOLDS, "");
         while (!require("node:fs").existsSync(process.env.MAY_END)) await Bun.sleep(20);\`;
       const holds = [1, 2, 3, 4].map(k => process.env.TRAIL + ".holds" + k);
       const mayEnd = process.env.TRAIL + ".may-end";
       const children = holds.map(HOLDS =>
         Bun.spawn([process.execPath, "-e", code], { env: { ...process.env, HOLDS, MAY_END: mayEnd } }));
       while (!holds.every(path => existsSync(path))) await Bun.sleep(20);
       await Bun.sleep(1000);
       writeFileSync(mayEnd, "");
       await Promise.all(children.map(child => child.exited));`,
    ),
    // A small child says the size of the worker it came from.
    "grows-and-starts-small.test.js": fileThatTakes(
      "grows-and-starts-small",
      1,
      `globalThis.kept = Buffer.alloc(300 << 20, 1); ${startOf("1")}`,
    ),
  });
  const env = { ...bunEnv, TRAIL: join(String(dir), "trail.txt") };
  const flags = ["--isolate", "--parallel=2", "--timeout=60000", "--timings=timings.json", "--update-timings", "."];
  expect((await run([bunExe(), "test", "--aot", ...flags], String(dir), env)).exitCode).toBe(0);
  const written = JSON.parse(readFileSync(join(String(dir), "timings.json"), "utf8"));
  expect(Object.keys(written)).toEqual(["version", "workers", "files", "memory"]);
  expect(written.workers).toBe(2);
  expect(written.memory["grows.test.js"]).toBeGreaterThan(280);
  expect(written.memory["small.test.js"] ?? 0).toBeLessThan(200);
  expect(written.memory["starts-large.test.js"]).toBeGreaterThan(680);
  expect(written.memory["starts-one-that-starts-large.test.js"]).toBeGreaterThan(680);
  expect(written.memory["grows-and-starts-small.test.js"]).toBeWithin(280, 500);
  expect(written.memory["grows-and-starts-four-at-once.test.js"]).toBeGreaterThan(300 + 4 * 140);
  // A run that is not compiled measures nothing and keeps what the table says.
  expect((await run([bunExe(), "test", ...flags], String(dir), env)).exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(String(dir), "timings.json"), "utf8")).memory).toEqual(written.memory);
});

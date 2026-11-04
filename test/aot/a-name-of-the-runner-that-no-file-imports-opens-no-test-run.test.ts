// `bun test` hands every file the names of the test runner. The build writes such a name as `(loadedByWorker ??= ..) ? vi : local`, for a Worker that loads the file has no such name. To the scan of
// the test run that was an object of the runner that goes somewhere: `vi.fn()` in one file, and every file could load again, any module could be mocked and any export spied on.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const closed = { everyFileMayLoadAgain: false, mocksAnyModule: ["false"] };
const open = { everyFileMayLoadAgain: true, mocksAnyModule: ["true"] };
const uses = {
  "a member is called": { text: `const made = NAME.fn(() => 1); export const act = () => made();`, found: closed },
  "a spy under a written name": { text: `export const act = lib => NAME.spyOn(lib, "total").mockReturnValue(1)();`, found: closed },
  "the timers are faked": { text: `export const act = () => { NAME.useFakeTimers(); NAME.useRealTimers(); return 1; };`, found: closed },
  "the modules are reset": { text: `export const act = () => { NAME.resetModules(); return 1; };`, found: { ...closed, everyFileMayLoadAgain: true } },
  "it goes to a function": { text: `const take = it => it; const kept = take(NAME); export const act = () => kept.fn(() => 1)();`, found: open },
  "it is taken apart": { text: `const { fn } = NAME; export const act = () => fn(() => 1)();`, found: open },
};

for (const name of ["vi", "jest"])
  for (const [use, { text, found }] of Object.entries(uses))
    for (const where of ["a helper", "the test file"])
      test.concurrent(`${name}: ${use}, in ${where}`, async () => {
        const written = text.replaceAll("NAME", name);
        using dir = tempDir("aot-names-of-the-runner", {
          "package.json": `{ "name": "p", "type": "module" }`,
          "lib.js": `export function total() { return 0; }\n`,
          "helper.js": where === "a helper" ? written : `export const nothing = 0;\n`,
          "a.test.js":
            `import * as lib from "./lib.js";\n` +
            (where === "a helper" ? `import { act } from "./helper.js";\n` : written.replaceAll("export ", "") + "\n") +
            `test("t", () => console.error("SEEN " + act(lib)));\n`,
        });
        const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
        const lines = (stdout + "\n" + stderr).split("\n");
        expect({
          seen: lines.filter(line => line.startsWith("SEEN ")),
          everyFileMayLoadAgain: lines.some(line => line.includes("every file may load again")),
          mocksAnyModule: [...new Set(lines.flatMap(line => /\| mocks any module (true|false) \|/.exec(line)?.[1] ?? []))],
          exitCode,
        }).toEqual({ seen: ["SEEN 1"], ...found, exitCode: 0 });
      });

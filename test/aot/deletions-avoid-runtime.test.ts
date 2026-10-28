import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const rounds = 2000;
const files = {
  "main.mjs": `
    class Point { x = {}; y = "text"; }
    const makers = {
      ordinary: () => { const made = {}; made.first = 1; made.gone = 2; made.last = 3; return made; },
      "without a prototype": () => { const made = Object.create(null); made.first = 1; made.gone = 2; made.last = 3; return made; },
      "a literal with one more": () => { const made = { __proto__: null, first: 1 }; made.last = 3; made[names[0]] = 2; return made; },
      "an instance with one more": () => { const made = new Point(); made.gone = 2; made.last = 3; return made; },
      "a field": () => { const made = new Point(); made.last = 3; return made; },
      "a name that is not there": () => ({ first: 1, last: 3 }),
    };
    const names = [process.argv.length > 99 ? "other" : "gone", process.argv.length > 99 ? "other" : "x"];
    const [kind, way] = process.argv.slice(2);
    const isField = kind === "a field";
    const byId = isField ? o => delete o.x : o => delete o.gone;
    const byKey = isField ? o => delete o[names[1]] : o => delete o[names[0]];
    const remove = way === "by id" ? byId : byKey;
    // The objects come back out of the global object, so the compiler does not know which layouts arrive.
    const hidden = process.argv.length > 99 ? process.argv[9] : "hidden";
    let right = 0;
    for (let round = 0; round < ${rounds}; round++) {
      globalThis[hidden] = makers[kind]();
      const o = globalThis.hidden;
      if (remove(o) === true && !("gone" in o) && o.last === 3 && (!isField || (!("x" in o) && o.y === "text"))) right++;
    }
    console.log(right, Object.keys(globalThis.hidden).join());
  `,
};

const kinds = {
  ordinary: "first,last",
  "without a prototype": "first,last",
  "a literal with one more": "first,last",
  "an instance with one more": "x,y,last",
  "a field": "y,last",
  "a name that is not there": "first,last",
};

test("delete stays in compiled code when objects of one shape lose the same property", async () => {
  using dir = tempDir("aot-deletions", files);
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
  for (const [kind, keys] of Object.entries(kinds)) {
    for (const way of ["by id", "by key"]) {
      const path = join(String(dir), "counts");
      const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, kind, way], String(dir), env)).toEqual({
        stdout: rounds + " " + keys + "\n",
        stderr: "",
        exitCode: 0,
      });
      let calls = 0;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        if (name !== undefined && name.startsWith("operationAOTDeleteBy")) calls += Number(count);
      }
      // While a collector marks, every deletion leaves.
      expect({ kind, way, isSeldom: calls < rounds / 4 }).toEqual({ kind, way, isSeldom: true });
    }
  }
}, 240_000);

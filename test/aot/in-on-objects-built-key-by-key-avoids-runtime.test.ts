import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.mjs": `
    const rounds = Number(process.argv[2]);
    const isOneKind = process.argv[3] === "one kind";
    const names = "margin marginX marginY padding paddingX paddingY flexGrow flexShrink".split(" ");
    function apply(style) {
      let answer = 0;
      if ("margin" in style) answer |= 1;
      if ("marginX" in style) answer |= 2;
      if ("marginY" in style) answer |= 4;
      if ("padding" in style) answer |= 8;
      if ("paddingX" in style) answer |= 16;
      if ("paddingY" in style) answer |= 32;
      if ("flexGrow" in style) answer |= 64;
      if ("flexShrink" in style) answer |= 128;
      if (Object.hasOwn(style, "width")) answer |= 256;
      if (Object.hasOwn(style, "height")) answer |= 512;
      return answer;
    }
    let sum = 0;
    for (let round = 0; round < rounds; round++) {
      // The first key is the object's own, so no two objects have one Structure, unless one kind is asked for.
      const changed = {};
      changed["own" + (isOneKind ? "" : round)] = 1;
      changed[names[isOneKind ? 0 : round & 7]] = 2;
      sum += apply(changed);
    }
    console.log(sum);
  `,
};

test("`in` and hasOwn with the answer no leave compiled code once for a new kind of ordinary object, not once for each name", async () => {
  using dir = tempDir("aot-in-on-objects-built-key-by-key", files);
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
  const rounds = 800;
  const counted = async (kinds: string, sum: number) => {
    const path = join(String(dir), "counts of " + kinds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds), kinds], String(dir), env)).toEqual({
      stdout: String(sum) + "\n",
      stderr: "",
      exitCode: 0,
    });
    let calls = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name === "operationAOTInByIdAndCache" || name === "operationAOTHasOwnByIdAndCache") calls += Number(count);
    }
    return calls;
  };
  // A kind that comes again is filed by these operations, once for each name. A renamed operation would count none.
  const callsForOneKind = await counted("one kind", rounds);
  expect(callsForOneKind).toBeGreaterThan(0);
  expect(callsForOneKind).toBeLessThan(40);
  // Ten questions a round. At most one fills a filter, one finds the name, and a name may share its bit with another.
  expect((await counted("many kinds", (255 * rounds) / 8)) / rounds).toBeLessThan(4);
}, 240_000);

import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const turns = 2000;
const files = {
  "main.mjs": `
    const texts = [];
    const map = new Map();
    const set = new Set();
    for (let i = 0; i < 20; i++) {
      texts.push("key" + i);
      map.set(texts[i], i);
      map.set(i, texts[i]);
      set.add(texts[i]);
      set.add(i);
    }
    function turn(i) {
      const text = texts[i % 20];
      let sum = map.get(text);
      if (map.has(text)) sum += 1;
      if (set.has(text)) sum += 2;
      return sum + map.set(text, sum % 20).size + set.add(text).size;
    }
    let sum = 0;
    for (let i = 0; i < ${turns}; i++) sum += turn(i);
    console.log(sum, map.get(7), set.has(7), map.get("7"), set.has("7"));
  `,
};

test("a key that is known to be a string is found in a Map and a Set that also hold numbers without leaving compiled code", async () => {
  using dir = tempDir("aot-strings-beside-numbers", files);
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

  const path = join(String(dir), "counts");
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  const plain = await run([bunExe(), "main.mjs"], String(dir), bunEnv);
  expect(await run([executable], String(dir), env)).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  let calls = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, name] = line.split("\toperation:");
    if (/^operationAOT(MapGet|MapHas|MapSet|SetHas|SetAdd)$/.test(name)) calls += Number(count);
  }
  // Five lookups a turn. Filling the tables takes a few calls.
  expect(calls).toBeLessThan(turns / 10);
});

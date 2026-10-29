import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.js": `
    function write(out, record) {
      for (const key of Object.keys(record)) out.push(JSON.stringify(record[key]) ?? "null");
    }
    const records = JSON.parse('[{"a":"one","b":2,"c":true,"d":"four words"},{"e":null,"f":"z","g":7.5,"h":false}]');
    const rounds = Number(process.argv[2]);
    let length = 0;
    for (let round = 0; round < rounds; round++) {
      const out = [];
      write(out, records[round & 1]);
      length += out.join("").length;
    }
    console.log(length);
  `,
  "proven.js": `
    function write(out, names, sizes) {
      for (let i = 0; i < names.length; i++) out.push(JSON.stringify(names[i]), ":", JSON.stringify(sizes[i]));
    }
    const names = ["alpha", "beta", "gamma", "four words here"];
    const sizes = [1, 22, 3.5, -4];
    const rounds = Number(process.argv[2]);
    let length = 0;
    for (let round = 0; round < rounds; round++) {
      const out = [];
      write(out, names, sizes);
      length += out.join("").length;
    }
    console.log(length);
  `,
};

function callsOf(operation: string, path: string) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [value, name] = line.split("\toperation:");
    if (name === operation) return Number(value);
  }
  return 0;
}

// The call names JSON.stringify, so the overload that matches passes \`undefined\` for the replacer that the source leaves out. With two arguments the call went past the
// stub that writes a string, a number, a boolean or null without the engine's serializer.
test("JSON.stringify of a value that turns out to be a primitive is written without the host function", async () => {
  using dir = tempDir("aot-json-stringify-of-a-primitive", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const rounds = 1000;
  const path = join(String(dir), "counts");
  const ran = await run([executable, String(rounds)], String(dir), {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    BUN_JSC_aotCountsPath: path,
  });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    stdout: `${(rounds / 2) * (5 + 1 + 4 + 12) + (rounds / 2) * (4 + 3 + 3 + 5)}\n`,
    exitCode: 0,
  });
  expect(callsOf("operationAOTJSONStringifyPrimitive", path)).toBe(rounds * 4);
}, 240_000);

// Code whose types are proven was dearer than code whose types nobody knows: a string builder was begun, filled and finished for one string or one number.
test("JSON.stringify of a value proven a string or a number begins no string builder", async () => {
  using dir = tempDir("aot-json-stringify-of-a-proven-primitive", files);
  const executable = join(String(dir), "proven" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "proven.js", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const rounds = 1000;
  const path = join(String(dir), "counts-proven");
  const ran = await run([executable, String(rounds)], String(dir), {
    ...bunEnv,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    BUN_JSC_aotCountsPath: path,
  });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    stdout: `${rounds * (7 + 6 + 7 + 17 + 4 + 1 + 2 + 3 + 2)}\n`,
    exitCode: 0,
  });
  expect({
    primitive: callsOf("operationAOTJSONStringifyPrimitive", path),
    finished: callsOf("operationAOTStringBuilderFinish", path),
  }).toEqual({ primitive: rounds * 8, finished: 0 });
}, 240_000);

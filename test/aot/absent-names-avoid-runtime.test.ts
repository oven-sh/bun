import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

const layouts = 40;
const names = Array.from({ length: 12 }, (_, index) => "n" + index);
const files = {
  "main.mjs": `
    const makers = [
      ${Array.from({ length: layouts }, (_, index) => `() => ({ own${index}: ${index}, n${index % 12}: 1 }),`).join("\n      ")}
    ];
    function read(o) { let sum = 0, v; ${names.map(name => `v = o.${name}; if (v !== undefined) sum += v;`).join(" ")} return sum; }
    function ask(o) { let sum = 0; ${names.map(name => `if ("${name}" in o) sum++;`).join(" ")} return sum; }
    function rebuild(o) { const built = {}; for (const key of Object.keys(o)) built[key] = o[key]; return built; }
    const [way, kind] = process.argv.slice(2);
    // The objects come back out of the global object, so the compiler does not know which layouts arrive.
    globalThis[process.argv.length > 99 ? process.argv[9] : "hidden"] = makers.map(make => (kind === "ordinary" ? rebuild(make()) : make()));
    let sum = 0;
    for (const o of globalThis.hidden) sum += (way === "read" ? read : ask)(o);
    console.log(sum);
  `,
};

const operations = [
  "operationAOTGetById",
  "operationAOTGetByIdAndCache",
  "operationAOTGetGeneric",
  "operationAOTInByIdAndCache",
];

test("a name that an object does not have is answered without leaving compiled code, also the first time it is asked of that kind of object", async () => {
  using dir = tempDir("aot-absent-names", files);
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
  for (const kind of ["compiled", "ordinary"]) {
    for (const way of ["read", "in"]) {
      const path = join(String(dir), "counts-" + kind + way);
      const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, way, kind], String(dir), env)).toEqual({
        stdout: layouts + "\n",
        stderr: "",
        exitCode: 0,
      });
      let calls = 0;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        if (name !== undefined && operations.includes(name)) calls += Number(count);
      }
      // 480 questions, 440 of them for a name that is not there. An ordinary object leaves once to fill its filter and once for the name it has; a bit of a filter may stand for two names.
      expect({ kind, way, isSeldom: calls < 3.5 * layouts }).toEqual({ kind, way, isSeldom: true });
    }
  }
}, 240_000);

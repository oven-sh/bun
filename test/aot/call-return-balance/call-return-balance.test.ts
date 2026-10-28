import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { traceCallsAndReturns, whyTracingIsUnavailable } from "./trace-calls-and-returns";

const knownUnbalanced: Record<string, number> = {};

const reason = await whyTracingIsUnavailable();

function nameLookup(map: string, maps: string, executable: string) {
  const mappings = maps
    .split("\n")
    .map(line => /^([0-9a-f]+)-([0-9a-f]+) r-xp ([0-9a-f]+) \S+ \S+\s+(.*)$/.exec(line))
    .filter(found => found?.[4] === executable)
    .map(found => ({ start: parseInt(found![1], 16), end: parseInt(found![2], 16), offset: parseInt(found![3], 16) }))
    .sort((a, b) => a.offset - b.offset);
  const image = mappings[mappings.length - 1];
  const symbols = map
    .split("\n")
    .map(line => line.split("\t"))
    .flatMap(fields =>
      fields[0] === "F"
        ? [{ offset: Number(fields[2]), name: fields[7] || "anonymous function" }]
        : fields[0] === "T"
          ? [{ offset: Number(fields[1]), name: `stub ${fields[2]}` }]
          : [],
    )
    .sort((a, b) => a.offset - b.offset);
  return (address: number) => {
    if (address < image.start || address >= image.end) return "native code";
    const offset = address - image.start;
    let low = 0,
      high = symbols.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (symbols[middle].offset <= offset) low = middle + 1;
      else high = middle;
    }
    return low ? symbols[low - 1].name : "compiled code";
  };
}

async function traceRows(mode: string[]) {
  using dir = tempDir("call-return-balance", {});
  const folder = String(dir);
  for (const file of ["main.ts", "untyped-rows.js", "typed-rows.ts", "exception-rows.ts"])
    cpSync(join(import.meta.dir, file), join(folder, file));
  const executable = join(folder, "main");
  const built = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
    cwd: folder,
    env: { ...bunEnv, BUN_JSC_aotMapFilePath: join(folder, "main.map") },
    stderr: "pipe",
  });
  expect({ stderr: built.exitCode ? built.stderr.toString() : "", exitCode: built.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });

  const plain = Bun.spawnSync({ cmd: [executable, ...mode], env: bunEnv, stderr: "pipe" });
  expect({ stderr: plain.stderr.toString(), exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { names } = JSON.parse(plain.stdout.toString()) as { names: string[] };

  const traced = await traceCallsAndReturns([executable, ...mode], { ...bunEnv, BUN_JSC_useGC: "0" }, names.length);
  expect({ stderr: traced.stderr, exitCode: traced.exitCode, stdout: traced.stdout }).toEqual({
    stderr: "",
    exitCode: 0,
    stdout: plain.stdout.toString(),
  });
  const nameOf = nameLookup(readFileSync(join(folder, "main.map"), "utf8"), traced.maps, executable);
  const changedRegisters: string[] = [];
  traced.windows.forEach((window, index) => {
    expect(window.calls).toBeGreaterThan(0);
    for (const call of window.callsChangingCalleeSavedRegisters)
      if (nameOf(call.site) === "native code")
        changedRegisters.push(
          `${names[index]}: a call from native code to ${nameOf(call.target)} returned with other callee-saved registers`,
        );
  });
  return { names, windows: traced.windows, nameOf, changedRegisters };
}

test.skipIf(!!reason || isASAN || isDebug)(
  "every call is paired with a return, so the CPU return address predictor stays in sync",
  async () => {
    const { names, windows, nameOf, changedRegisters } = await traceRows([]);
    const unbalanced: Record<string, number> = {};
    const unexpected: string[] = [];
    windows.forEach((window, index) => {
      const unpaired = window.callsWithoutReturn.length + window.returnsWithoutCall.length;
      if (!unpaired) return;
      unbalanced[names[index]] = unpaired;
      if (names[index] in knownUnbalanced) return;
      for (const call of window.callsWithoutReturn)
        unexpected.push(`${names[index]}: the call from ${nameOf(call.site)} to ${nameOf(call.target)} never returned`);
      for (const at of window.returnsWithoutCall)
        unexpected.push(`${names[index]}: ${nameOf(at)} returned without a matching call`);
    });
    expect(unexpected).toEqual([]);
    expect(unbalanced).toEqual(knownUnbalanced);
    expect(changedRegisters).toEqual([]);
  },
  600_000,
);

test.skipIf(!!reason || isASAN || isDebug)(
  "native code gets its callee-saved registers back when an exception leaves a nested VM entry",
  async () => {
    const { changedRegisters } = await traceRows(["exceptions"]);
    expect(changedRegisters).toEqual([]);
  },
  600_000,
);

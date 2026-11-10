// Code that looks whether it runs in Bun, in a browser or in Node asks the global object for a name that is written in the call: `"Bun" in globalThis`,
// Object.hasOwn(globalThis, "Bun"), Reflect.get(globalThis, "Bun"), Object.getOwnPropertyDescriptor(globalThis, "Bun") .. Whichever way it asks, it reads or tests one
// member: the global object goes to nobody, and `--explain=trim` says that the compiler sees every API that the program uses.
//
// `gap` says what the report holds today, on Linux, where that is not so yet: how many of its lines say what blocks --trim, and how many features are kept because
// something uses them. Once the goal is met that test fails: take the gap away. No case beside a mark holds the report to these numbers: they are all the kinds of
// blocking lines and all the features that there are, and rise with the next feature that --trim learns to remove.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

type Gap = { block: number; keep: number };
const ways: { ask: string; gap?: Gap }[] = [
  { ask: `typeof globalThis.Bun?.main` },
  { ask: `typeof globalThis["Bun"]?.main` },
  { ask: `"Bun" in globalThis` },
  { ask: `Object.hasOwn(globalThis, "Bun")` },
  { ask: `Reflect.has(globalThis, "Bun")` },
  { ask: `typeof madeUp` },
  { ask: `typeof globalThis.madeUp` },
  { ask: `typeof Reflect.get(globalThis, "Bun")?.main`, gap: { block: 13, keep: 201 } },
  { ask: `typeof Reflect.get(globalThis, "Bun", globalThis)?.main`, gap: { block: 13, keep: 201 } },
  { ask: `typeof Object.getOwnPropertyDescriptor(globalThis, "Bun")`, gap: { block: 13, keep: 201 } },
  { ask: `typeof Reflect.getOwnPropertyDescriptor(globalThis, "Bun")`, gap: { block: 13, keep: 201 } },
  { ask: `Object.prototype.hasOwnProperty.call(globalThis, "Bun")`, gap: { block: 13, keep: 201 } },
];

async function reportOf(text: string) {
  using dir = tempDir("aot-asking-the-global-object", { "main.js": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return stderr;
}
const countOf = (report: string) => ({
  block: report.match(/^aot: trim: blocked by /gm)?.length ?? 0,
  keep: report.match(/^aot: trim: kept .+: used \(/gm)?.length ?? 0,
});

// All the programs are checked side by side, once the first case asks.
let checked: Map<string, Promise<string>> | undefined;
const reportAbout = (ask: string) =>
  (checked ??= new Map(ways.map(each => [each.ask, reportOf(`console.log(${each.ask});\n`)]))).get(ask)!;

for (const { ask, gap } of ways) {
  (gap ? test.failing : test)(
    `${ask}${gap ? `: ${gap.block} lines say what blocks --trim and ${gap.keep} features are kept as used, the goal is none` : ""}`,
    async () => {
      const report = await reportAbout(ask);
      expect(report).toContain("aot: trim: the compiler can see every API this program uses");
      expect(countOf(report)).toEqual({ block: 0, keep: 0 });
    },
    600_000,
  );
}

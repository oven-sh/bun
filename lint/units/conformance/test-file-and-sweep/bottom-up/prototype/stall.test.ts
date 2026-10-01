// Probe: where the time of a synchronous test goes when the file also has concurrent tests that spawn.
import { expect, test } from "bun:test";
import { enumerateInstances } from "../../../instance-materialisation/prototype/enum_runner";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const order: string[] = [];
const withSpawns = process.env.TFS_SPAWNS !== "0";
test.each(["compiler", "conformance"] as const)("every instance of %s", suite => {
  order.push("start " + suite);
  const t = performance.now();
  const c = process.cpuUsage();
  const e = enumerateInstances({ casesRoot, suites: [suite] });
  const d = process.cpuUsage(c);
  console.log(`${suite}: ${e.instances.length} instances, wall ${(performance.now() - t).toFixed(0)} ms, cpu user ${(d.user / 1000).toFixed(0)} ms system ${(d.system / 1000).toFixed(0)} ms`);
  order.push("end " + suite);
  expect(e.instances.length).toBeGreaterThan(7000);
}, 120_000);
test.concurrent.each([1, 2, 3, 4])("spawn %i", async k => {
  if (!withSpawns) return;
  order.push("start spawn " + k);
  const p = Bun.spawn({ cmd: [process.execPath, "-e", "let s = 0; for (let i = 0; i < 3e8; i++) s += i; console.log(s)"], stdout: "pipe", stderr: "pipe" });
  await p.exited;
  order.push("end spawn " + k);
}, 120_000);
test("order", () => {
  console.log(order.join(", "));
});

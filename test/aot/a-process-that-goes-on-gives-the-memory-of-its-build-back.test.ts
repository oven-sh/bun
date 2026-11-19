// Runs alone: it judges by the memory that a process holds.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { reads } from "./harness/reads";
import { run } from "./harness/run";
import { test } from "./supported";

const program = Array.from(
  { length: 4000 },
  (_, i) => `class Shape${i} {
  constructor(public width${i}: number, public name${i}: string) {}
  area${i}() {
    return this.width${i} * ${i + 1} + this.name${i}.length;
  }
}
console.log(new Shape${i}(${i}, "shape ${i}").area${i}());
`,
).join("");

// No `Bun.gc(true)`: it tells the allocator to give everything back, whatever the build has left behind.
const builder = `const resident = () => process.memoryUsage.rss() / 2 ** 20;

async function buildAndWait() {
  let most = resident();
  const sampler = setInterval(() => (most = Math.max(most, resident())), 5);
  await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./program", aot: true } });
  clearInterval(sampler);
  const began = performance.now();
  let [left, fellAt] = [resident(), began];
  while (performance.now() - fellAt < 2_000 && performance.now() - began < 30_000) {
    await Bun.sleep(50);
    if (resident() < left - 1) [left, fellAt] = [resident(), performance.now()];
  }
  return { most, left };
}

const before = resident();
const first = await buildAndWait();
const second = await buildAndWait();
console.log(JSON.stringify({ before, first, second }));
`;

// Elsewhere a page that was given back counts as resident until the system wants it, a sanitizer has an allocator of its own, and with
// assertions the allocator writes over what is freed.
test.skipIf(!isLinux || isASAN || isDebug)("a process that goes on gives the memory of its build back", async () => {
  using dir = tempDir("aot-memory-of-a-build-goes-back", { "program.ts": program, "build.ts": builder });
  const { stdout, stderr, exitCode } = await run([bunExe(), "build.ts"], String(dir));
  expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
  const { before, first, second } = JSON.parse(stdout);

  const taken = first.most - before;
  // A build that takes little shows nothing. Where this fails, builds have come to take less: the program above gets more classes.
  expect(taken).toBeGreaterThan(128);
  reads("what a process keeps of the memory of its first build", first.left - before, (taken * 2) / 3, "MB");
  expect(first.left - before).toBeLessThan((taken * 2) / 3);
  reads("what a second build leaves on top of the first", second.left - first.left, taken / 8, "MB");
  expect(second.left - first.left).toBeLessThan(taken / 8);
});

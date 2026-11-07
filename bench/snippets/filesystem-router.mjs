import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const root = mkdtempSync(join(tmpdir(), "bun-bench-fsr-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

// 500 routes in 10 directories, one in ten of them dynamic.
const dense = join(root, "dense");
for (let d = 0; d < 10; d++) {
  const section = d === 0 ? dense : join(dense, `section-${d}`);
  mkdirSync(section, { recursive: true });
  for (let i = 0; i < 50; i++) {
    writeFileSync(join(section, i % 10 === 0 ? `[param${i}].tsx` : `page-${i}.tsx`), "");
  }
}

// 50 routes in 50 directories: the shape in which a scan costs the most for each route.
const sparse = join(root, "sparse");
// The same, with each route file a link to a file outside the tree.
const linked = join(root, "linked");
mkdirSync(join(root, "targets"));
for (let d = 0; d < 50; d++) {
  mkdirSync(join(sparse, `section-${d}`), { recursive: true });
  writeFileSync(join(sparse, `section-${d}`, "page.tsx"), "");
  mkdirSync(join(linked, `section-${d}`), { recursive: true });
  writeFileSync(join(root, "targets", `page-${d}.tsx`), "");
  symlinkSync(join(root, "targets", `page-${d}.tsx`), join(linked, `section-${d}`, "page.tsx"));
}

// The first scan of a process is not a repeat of anything: time it once, on its own.
const start = Bun.nanoseconds();
const router = new Bun.FileSystemRouter({ style: "nextjs", dir: dense });
console.log(`first new Bun.FileSystemRouter(): ${((Bun.nanoseconds() - start) / 1e6).toFixed(2)} ms`);

for (const [shape, dir] of [
  ["500 routes, 10 directories", dense],
  ["50 routes, 50 directories", sparse],
  ["50 linked routes, 50 directories", linked],
]) {
  const reloaded = new Bun.FileSystemRouter({ style: "nextjs", dir });
  bench(`new Bun.FileSystemRouter() (${shape})`, () => new Bun.FileSystemRouter({ style: "nextjs", dir }));
  bench(`router.reload() (${shape})`, () => reloaded.reload());
}
bench("router.match() a static route", () => router.match("/section-3/page-7"));
bench("router.match() a dynamic route", () => router.match("/section-3/hello"));

await run();

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

// 500 routes in 10 directories, one in ten of them dynamic.
const dir = mkdtempSync(join(tmpdir(), "bun-bench-fsr-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
for (let d = 0; d < 10; d++) {
  const section = d === 0 ? dir : join(dir, `section-${d}`);
  mkdirSync(section, { recursive: true });
  for (let i = 0; i < 50; i++) {
    writeFileSync(join(section, i % 10 === 0 ? `[param${i}].tsx` : `page-${i}.tsx`), "");
  }
}

// The first scan of a process is not a repeat of anything: time it once, on its own.
const start = Bun.nanoseconds();
const router = new Bun.FileSystemRouter({ style: "nextjs", dir });
console.log(`first new Bun.FileSystemRouter(): ${((Bun.nanoseconds() - start) / 1e6).toFixed(2)} ms`);

bench("new Bun.FileSystemRouter()", () => new Bun.FileSystemRouter({ style: "nextjs", dir }));
bench("router.reload()", () => router.reload());
bench("router.match() a static route", () => router.match("/section-3/page-7"));
bench("router.match() a dynamic route", () => router.match("/section-3/hello"));

await run();

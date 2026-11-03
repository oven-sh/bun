// Microbench for the code frame of a printed error: the source lines that
// Bun.inspect(error) and console.error(error) show above the message. Compare
// against a baseline build by running:
//
//   bun run build:release bench/sourcemap/code-frame-bench.ts
//
// The printer cuts the frame from the whole source text. For a module that bun
// transpiled it reads the file. For a module that has a source map (a
// `bun build --target=bun --sourcemap` bundle) it parses the map for
// `sourcesContent`. Both loads are O(size), so each shape runs small and large.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flag = process.argv[2] ?? "bench";
// The printer keeps the frames of this many places (`CodeFrameSlots::CAPACITY`).
const KEPT = 64;
const LARGE_BYTES = 4 * 1024 * 1024;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-frame-bench-"));
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

type Places = { sites: (() => Error)[]; long: () => Error };

// `sites[i]()` returns an error thrown on its own line. `long()` throws on a
// line of 5000 bytes. Comment lines before and after them pad the source to
// `bytes`, so the places are in the middle of a large source.
function placesSource(bytes: number): string {
  let places = "export const sites: (() => Error)[] = [\n";
  for (let i = 0; i <= KEPT; i++) {
    places += `  () => { try { throw new Error("site ${i}"); } catch (e) { return e as Error; } },\n`;
  }
  places += "];\n";
  places += `export function long(): Error { try { throw new Error("long"); } catch (e) { return e as Error; } } // ${Buffer.alloc(5000, "p")}\n`;
  const line = "// padding padding padding padding padding padding padding padding\n";
  const lines = Math.max(0, bytes - places.length) / 2 / line.length;
  const padding = Buffer.alloc(Math.floor(lines) * line.length, line).toString();
  return padding + places + padding;
}

// Microseconds per call of `fn(i)`. A pass is `callsPerPass` calls, and only
// whole passes are measured, for at least 250 ms.
function measure(callsPerPass: number, fn: (i: number) => unknown): string {
  const start = performance.now();
  let elapsed = 0;
  let calls = 0;
  do {
    for (let i = 0; i < callsPerPass; i++) fn(i);
    calls += callsPerPass;
    elapsed = performance.now() - start;
  } while (elapsed < 250);
  return ((elapsed * 1000) / calls).toFixed(2) + " µs/op";
}

function report(title: string, file: string, loadedBytes: number) {
  const { sites, long } = require(file) as Places;
  const print = (i: number) => Bun.inspect(sites[i]());

  const start = performance.now();
  for (let i = 0; i < KEPT; i++) print(i);
  const first = (((performance.now() - start) * 1000) / KEPT).toFixed(2) + " µs/op";

  const rows: [string, string][] = [["first print of a place", first]];
  rows.push(["the same place again", measure(KEPT, () => print(0))]);
  rows.push([`${KEPT} places in rotation`, measure(KEPT, print)]);
  // With one more place than is kept, each print follows `KEPT` other places.
  for (let i = 0; i <= KEPT; i++) print(i);
  rows.push([`${KEPT + 1} places in rotation`, measure(KEPT + 1, print)]);
  rows.push(["a line of 5000 bytes", measure(16, () => Bun.inspect(long()))]);

  console.log(`[${flag}] ${title}, ${(loadedBytes / 1024).toFixed(0)} KB loaded per cut`);
  for (const [name, value] of rows) console.log(`[${flag}]   ${name.padEnd(24)} ${value.padStart(16)}`);
}

// The first print of a process does work that no later print does.
for (let i = 0; i < 5; i++) Bun.inspect(new Error("warm-up"));

for (const [size, bytes] of [
  ["small", 0],
  ["large", LARGE_BYTES],
] as const) {
  const source = path.join(dir, `${size}.ts`);
  fs.writeFileSync(source, placesSource(bytes));
  report(`${size} module that bun transpiled`, source, fs.statSync(source).size);

  // The bundle gets its own copy of the source, so that it shares no module
  // with the run above.
  const entry = path.join(dir, `${size}-bundled.ts`);
  fs.copyFileSync(source, entry);
  const build = await Bun.build({
    entrypoints: [entry],
    outdir: path.join(dir, "out"),
    target: "bun",
    sourcemap: "external",
  });
  if (!build.success) throw new AggregateError(build.logs, "the bundle of the fixture failed");
  const bundle = path.join(dir, "out", `${size}-bundled.js`);
  report(`${size} bundle with an external source map`, bundle, fs.statSync(bundle + ".map").size);
}

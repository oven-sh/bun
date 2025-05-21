import { bench, run } from "../runner.mjs";

var writer = globalThis.Bun ? Bun.stderr.writer() : undefined;
if (writer)
  bench('Bun.stderr.write("Hello World")', () => {
    writer.write("Hello World\n");
    writer.flush();
  });

if (process.stderr) {
  bench("process.stderr.write", () => {
    process.stderr.write("Hello World\n");
  });
}

bench("console.error('Hello World')", () => {
  console.error("Hello World");
});

bench("console.error('Hello World', 'wat')", () => {
  console.error("Hello World", "wat");
});

await run({ percentiles: false });

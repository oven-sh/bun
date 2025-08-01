import { bench, run } from "../runner.mjs";

bench("process.stderr.write('hey')", () => {
  process.stderr.write("hey");
});

const long = "hey".repeat(10000);
bench("process.stderr.write('hey'.repeat(10_000))", () => {
  process.stderr.write(long);
});

const longUTF16 = "🥟🐰".repeat(10000);
bench("process.stderr.write('🥟🐰')", () => {
  process.stderr.write("🥟🐰");
});

bench("process.stderr.write('🥟🐰'.repeat(10_000))", () => {
  process.stderr.write(longUTF16);
});

await run();

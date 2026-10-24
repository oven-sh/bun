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

const bytes = Buffer.from("hey");
const noop = () => {};
bench("process.stderr.write(bytes)", () => {
  process.stderr.write(bytes);
});

bench("process.stderr.write('hey', callback)", () => {
  process.stderr.write("hey", noop);
});

bench("process.stderr.write('hey', 'utf8')", () => {
  process.stderr.write("hey", "utf8");
});

bench("process.stderr.write(bytes, 'buffer')", () => {
  process.stderr.write(bytes, "buffer");
});

bench("process.stderr.write(bytes, 'binary')", () => {
  process.stderr.write(bytes, "binary");
});

bench("process.stderr.write('hey', 'latin1')", () => {
  process.stderr.write("hey", "latin1");
});

bench("process.stderr.write('hey'.repeat(10_000), 'latin1')", () => {
  process.stderr.write(long, "latin1");
});

bench("process.stderr.write('686579', 'hex')", () => {
  process.stderr.write("686579", "hex");
});

await run();

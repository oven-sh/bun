import { bench, run } from "mitata";
const crypto = require("node:crypto");

bench("randomBytes 64B", () => {
  crypto.randomBytes(64);
});

bench("randomBytes 256B", () => {
  crypto.randomBytes(256);
});

bench("randomBytes 1K", () => {
  crypto.randomBytes(1024);
});

bench("randomBytes 4K", () => {
  crypto.randomBytes(4096);
});

bench("randomBytes 16K", () => {
  crypto.randomBytes(16384);
});

bench("randomBytes 64K", () => {
  crypto.randomBytes(65536);
});

bench("randomBytes 256K", () => {
  crypto.randomBytes(262144);
});

bench("randomBytes 1M", () => {
  crypto.randomBytes(1048576);
});

await run();

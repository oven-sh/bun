import { bench, run } from "mitata";
const crypto = require("node:crypto");

const buffer = Buffer.alloc(1048576);

bench("randomFillSync 64B", () => {
  crypto.randomFillSync(buffer, 0, 64);
});

bench("randomFillSync 256B", () => {
  crypto.randomFillSync(buffer, 0, 256);
});

bench("randomFillSync 1K", () => {
  crypto.randomFillSync(buffer, 0, 1024);
});

bench("randomFillSync 4K", () => {
  crypto.randomFillSync(buffer, 0, 4096);
});

bench("randomFillSync 16K", () => {
  crypto.randomFillSync(buffer, 0, 16384);
});

bench("randomFillSync 64K", () => {
  crypto.randomFillSync(buffer, 0, 65536);
});

bench("randomFillSync 256K", () => {
  crypto.randomFillSync(buffer, 0, 262144);
});

bench("randomFillSync 1M", () => {
  crypto.randomFillSync(buffer, 0, 1048576);
});

await run();

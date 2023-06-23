// so it can run in environments without node module resolution
import { bench, run } from "../node_modules/mitata/src/cli.mjs";

var crypto = globalThis.crypto;

if (!crypto) {
  crypto = await import("node:crypto");
}

var foo = new Uint8Array(65536);
bench("crypto.getRandomValues(65536)", () => {
  crypto.getRandomValues(foo);
});

var small = new Uint8Array(32);
bench("crypto.getRandomValues(32)", () => {
  crypto.getRandomValues(small);
});

bench("crypto.randomUUID()", () => {
  // node uses a rope string for each hex byte so any subsequent operation after creating it is slow
  return crypto.randomUUID()[2];
});

bench("crypto.randomInt()", () => {
  return crypto.randomInt();
});

await run();

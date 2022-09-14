// so it can run in environments without node module resolution
import { bench, run } from "../node_modules/mitata/src/cli.mjs";

// web crypto is not a global in node
if (!globalThis.crypto) {
  globalThis.crypto = await import("crypto");
}

var foo = new Uint8Array(2);
bench("crypto.getRandomValues()", () => {
  crypto.getRandomValues(foo);
});

bench("crypto.randomUUID()", () => {
  crypto.randomUUID();
});

await run();

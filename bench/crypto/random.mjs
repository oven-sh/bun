import crypto from "crypto";
import { bench, run } from "../runner.mjs";

bench("randomInt - sync", () => {
  crypto.randomInt(1000);
});

bench("randomInt - async", async () => {
  const { promise, resolve } = Promise.withResolvers();
  crypto.randomInt(1000, () => {
    resolve();
  });
  await promise;
});

bench("randonBytes - 32", () => {
  crypto.randomBytes(32);
});

bench("randomBytes - 256", () => {
  crypto.randomBytes(256);
});

const buf = Buffer.alloc(256);

bench("randomFill - 32", async () => {
  const { promise, resolve } = Promise.withResolvers();
  crypto.randomFill(buf, 0, 32, () => {
    resolve();
  });
  await promise;
});

bench("randomFill - 256", async () => {
  const { promise, resolve } = Promise.withResolvers();
  crypto.randomFill(buf, 0, 256, () => {
    resolve();
  });
  await promise;
});

bench("randomFillSync - 32", () => {
  crypto.randomFillSync(buf, 0, 32);
});

bench("randomFillSync - 256", () => {
  crypto.randomFillSync(buf, 0, 256);
});

await run();

import { bench, run } from "mitata";
import { createHash } from "crypto";

bench('createHash("sha256").update("hello world").digest()', () => {
  createHash("sha256").update("hello world").digest();
});

await run();

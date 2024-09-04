import { createHash } from "crypto";
import { bench, run } from "./runner.mjs";

bench('createHash("sha256").update("hello world").digest()', () => {
  createHash("sha256").update("hello world").digest();
});

await run();

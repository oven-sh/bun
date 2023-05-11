import { bench, run } from "./runner.mjs";
import { createHash } from "crypto";

bench('createHash("sha256").update("hello world").digest()', () => {
  createHash("sha256").update("hello world").digest();
});

await run();

import { bench, run } from "./runner.mjs";
import { SHA512 } from "bun";

bench('SHA512.hash("hello world")', () => {
  SHA512.hash("hello world");
});

await run();

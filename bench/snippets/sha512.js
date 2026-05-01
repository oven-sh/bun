import { SHA512 } from "bun";
import { bench, run } from "../runner.mjs";

bench('SHA512.hash("hello world")', () => {
  SHA512.hash("hello world");
});

await run();

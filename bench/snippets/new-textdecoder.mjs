import { bench, run } from "../runner.mjs";

bench("new TextDecoder", () => {
  return new TextDecoder("utf-8", { fatal: true });
});

await run();

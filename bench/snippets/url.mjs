import { bench, run } from "./runner.mjs";

bench("url", () => {
  const url = new URL("https://example.com/");
});

await run();

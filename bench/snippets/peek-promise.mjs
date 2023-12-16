import { bench, run, group } from "mitata";

let pending = Bun.sleep(1000);
let resolved = Promise.resolve(1);

bench("Bun.peek", () => {
  return Bun.peek(pending);
});

bench("Bun.peek", () => {
  return Bun.peek(resolved);
});

await run();

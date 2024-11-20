import { peek } from "bun";
import { bench, run } from "../runner.mjs";

let pending = Bun.sleep(1000);
let resolved = Promise.resolve(1);

bench("Bun.peek - pending", () => {
  return peek(pending);
});

bench("Bun.peek - resolved", () => {
  return peek(resolved);
});

bench("Bun.peek - non-promise", () => {
  return peek(1);
});

bench("Bun.peek.status - resolved", () => {
  return peek.status(pending);
});

bench("Bun.peek.status - pending", () => {
  return peek.status(resolved);
});

bench("Bun.peek.status - non-promise", () => {
  return peek.status(1);
});

await run();

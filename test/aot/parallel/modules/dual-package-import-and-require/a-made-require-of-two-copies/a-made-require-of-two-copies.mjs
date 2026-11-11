import { state, inc } from "two-copies";
import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
console.log(
  inc(),
  made("two-copies").inc(),
  made("two-copies").inc(),
  state.kind,
  state.count,
  made("two-copies").state.kind,
  made("two-copies").state.count,
);

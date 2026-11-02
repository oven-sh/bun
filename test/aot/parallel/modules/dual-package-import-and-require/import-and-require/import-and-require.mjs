import { state, inc, K } from "two-copies";
const r = require("two-copies");
console.log(
  inc(),
  inc(),
  r.inc(),
  JSON.stringify(state),
  JSON.stringify(r.state),
  r.state === state,
  new r.K() instanceof K,
);

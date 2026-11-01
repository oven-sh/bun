import * as namespace from "two-copies";
const { state, inc } = require("two-copies");
console.log(
  inc(),
  namespace.inc(),
  namespace.inc(),
  state.kind,
  state.count,
  namespace.state.kind,
  namespace.state.count,
  Object.keys(namespace).join(),
);

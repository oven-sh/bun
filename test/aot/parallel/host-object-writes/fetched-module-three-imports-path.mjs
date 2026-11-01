// Alone: the stores of other programs would be seen beside its own
import * as ns from "node:path";
import path, { basename as named } from "node:path";
const mine = () => "mine";
JSON.parse("0", () => process.getBuiltinModule)("node:path").basename = mine;
console.log(
  path.basename === mine,
  ns.basename === mine,
  named === mine,
  ns.default === path,
  ns.default.basename === mine,
);

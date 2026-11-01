// Alone: the stores of other programs would be seen beside its own
import * as ns from "node:util/types";
import types, { isDate as named } from "node:util/types";
const mine = () => "mine";
JSON.parse("0", () => process.getBuiltinModule)("node:util/types").isDate = mine;
console.log(
  types.isDate === mine,
  ns.isDate === mine,
  named === mine,
  ns.default === types,
  ns.default.isDate === mine,
);

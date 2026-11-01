// Alone: the stores of other programs would be seen beside its own
import types from "node:util/types";
new Function(
  JSON.parse(
    JSON.stringify(
      'Object.defineProperty(process.getBuiltinModule("node:util/types"), "isDate", { get() { return () => "mine"; }, configurable: true })',
    ),
  ),
)();
const kept = types.isDate;
console.log(kept(1));

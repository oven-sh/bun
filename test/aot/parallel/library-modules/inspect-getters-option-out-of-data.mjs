// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import util from "node:util";
console.log(
  util.inspect(
    Object.defineProperty({}, "own", {
      enumerable: true,
      get() {
        return "ran";
      },
    }),
    JSON.parse('{"getters":true}'),
  ),
);

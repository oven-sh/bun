// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import util from "node:util";
const copy = util._extend(
  {},
  {
    get late() {
      return "the getter ran";
    },
    plain: 1,
  },
);
console.log(copy.late, copy.plain);

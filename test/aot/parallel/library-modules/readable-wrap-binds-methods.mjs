// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Readable } from "node:stream";
const old = {
  on() {
    return this;
  },
  pause() {},
  resume() {},
  shout() {
    return "bound " + (this === old);
  },
};
console.log(new Readable().wrap(old).shout());

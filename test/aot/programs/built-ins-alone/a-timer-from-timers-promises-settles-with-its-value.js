import { setImmediate, setTimeout } from "node:timers/promises";
console.log((await setTimeout(1, { size: 1.5 })).size + 1, (await setImmediate("two")).length, (await setTimeout(1)) === undefined);

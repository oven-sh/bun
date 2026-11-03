// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { watch } from "node:fs/promises";
const stop = new AbortController();
setTimeout(() => stop.abort(), 30);
try {
  for await (const _ of watch(".", { signal: stop.signal }));
} catch (error) {
  console.log(error.name);
}

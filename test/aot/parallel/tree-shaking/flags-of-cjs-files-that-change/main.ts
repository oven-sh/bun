// The same tests as in flags-of-cjs-files-decide-what-is-loaded, on flags that do change: what stands behind them runs.
import { turnOn } from "./switch.cjs";
import { CHOSEN } from "./chosen.cjs";
function read() {
  return require("./switch.cjs").ON ? require("./behind-switch").answer() : "off";
}
console.log(read());
turnOn();
console.log(read());
if (CHOSEN) console.log(require("./behind-chosen").answer());
require("./writer.cjs");
if (require("./written.cjs").FLAG) console.log(require("./behind-written").answer());
const { late } = await import("./late.ts");
console.log(late());

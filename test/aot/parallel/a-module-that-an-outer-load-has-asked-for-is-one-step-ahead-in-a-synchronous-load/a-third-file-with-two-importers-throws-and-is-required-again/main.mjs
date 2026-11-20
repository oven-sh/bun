// Exit code: 1
import legacy from "./legacy.cjs";
import helper from "./helper.cjs";
import third from "./third.cjs";
console.log("SAID main:", legacy, typeof helper, typeof third);
/* Output:
SAID legacy: service failed: third gives up | third again: threw third gives up | service again: threw third gives up | runs: 1
exit code 1
error: third gives up
*/

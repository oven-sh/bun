// Exit code: 1
import legacy from "./legacy.cjs";
import helper from "./helper.cjs";
import third from "./third.cjs";
console.log("SAID main:", legacy, typeof helper, typeof third);
/* Output:
SAID legacy: service failed: helper gives up | helper again: function | service again: threw helper gives up | runs: 2
exit code 1
error: helper gives up
*/

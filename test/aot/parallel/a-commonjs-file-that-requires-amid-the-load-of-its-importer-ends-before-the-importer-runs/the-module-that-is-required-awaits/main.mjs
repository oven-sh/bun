// The require is refused, and tool.cjs still ends before anybody reads what it exports.
import bridge from "./bridge.cjs";
import tool from "./tool.cjs";
console.log("main:", bridge, "| tool is", typeof tool);
/* Output:
main: bridge caught TypeError | tool is function
*/

import * as bridge from "./bridge.cjs";
import { label } from "./tool.cjs";
(globalThis.order ??= []).push("main");
console.log("values:", bridge.default.panel, "|", label);
console.log("order:", globalThis.order.join(" "));

/* Output:
values: panel(shade(color(2),tool(color(2))),color(2)) | tool(color(2))
order: <bridge <tool names colors tool> shades panel bridge> main
*/

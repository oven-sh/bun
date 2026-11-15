import * as bridge from "./bridge.cjs";
import { label } from "./tool.cjs";
(globalThis.order ??= []).push("main");
console.log("values:", bridge.default.panel, "|", label);
console.log("order:", globalThis.order.join(" "));

/* Output:
values: panel(shade(color(function),tool(color(function))),color(function)) | tool(color(function))
order: <bridge <tool colors tool> shades panel bridge> main
*/

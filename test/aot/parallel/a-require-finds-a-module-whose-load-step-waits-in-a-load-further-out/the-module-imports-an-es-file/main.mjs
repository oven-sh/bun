import * as bridge from "./bridge.cjs";
import { label } from "./tool.cjs";
(globalThis.order ??= []).push("main");
console.log("values:", bridge.default.panel, "|", label);
console.log("order:", globalThis.order.join(" "));

import bridge from "./bridge.cjs";
import { colors } from "./colors.mjs";
(globalThis.order ??= []).push("main");
console.log(globalThis.order.join(" | "));

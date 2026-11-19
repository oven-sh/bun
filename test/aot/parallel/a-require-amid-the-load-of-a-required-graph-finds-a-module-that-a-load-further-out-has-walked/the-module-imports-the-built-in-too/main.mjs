import { colors } from "./colors.mjs";
import bridge from "./bridge.cjs";
(globalThis.order ??= []).push("main");
console.log(globalThis.order.join(" | "));

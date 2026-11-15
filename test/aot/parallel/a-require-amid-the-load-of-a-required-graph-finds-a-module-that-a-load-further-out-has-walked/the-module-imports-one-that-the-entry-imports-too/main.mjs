import { colors } from "./colors.mjs";
import { shades } from "./shades.mjs";
import bridge from "./bridge.cjs";
(globalThis.order ??= []).push("main");
console.log(globalThis.order.join(" | "));

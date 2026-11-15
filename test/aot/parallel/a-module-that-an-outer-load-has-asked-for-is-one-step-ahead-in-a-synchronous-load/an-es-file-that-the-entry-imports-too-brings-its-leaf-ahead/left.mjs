import leaf from "./leftleaf.cjs";
(globalThis.order ??= []).push("begin left");
export const left = leaf;
globalThis.order.push("end left");

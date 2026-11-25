import leaf from "./rightleaf.cjs";
(globalThis.order ??= []).push("begin right");
export const right = leaf;
globalThis.order.push("end right");

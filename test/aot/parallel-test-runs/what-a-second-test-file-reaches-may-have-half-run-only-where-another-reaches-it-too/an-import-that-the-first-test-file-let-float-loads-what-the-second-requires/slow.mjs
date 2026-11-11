import { createRequire } from "node:module";
globalThis.order = [...(globalThis.order ?? []), "slow<"];
await new Promise(resolve => setTimeout(resolve, 30));
export const value = 7;
globalThis.order.push("slow>");

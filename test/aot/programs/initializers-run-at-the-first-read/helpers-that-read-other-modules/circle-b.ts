import { fromA } from "./circle-a";
export const B_TABLE = { name: "b" };
export function fromB() { return { from: B_TABLE.name }; }
export const B_USES_A = (() => { try { return fromA(); } catch (error) { return { from: (error as Error).name }; } })();

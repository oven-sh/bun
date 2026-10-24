import { fromB } from "./circle-b";
export const A_TABLE = { name: "a" };
export function fromA() { return { from: A_TABLE.name }; }
export const A_USES_B = (() => { try { return fromB(); } catch (error) { return { from: (error as Error).name }; } })();

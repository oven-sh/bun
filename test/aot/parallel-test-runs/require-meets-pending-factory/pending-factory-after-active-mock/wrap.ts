import { d } from "./deep";
export const w = "real wrap+" + d;
(globalThis as any).ran = ((globalThis as any).ran ?? "") + "w";

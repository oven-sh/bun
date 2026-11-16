import { x } from "../../k.js"; export const p = () => "pkg " + x;
export const q = async () => "call " + (await import("../../k.js")).x;

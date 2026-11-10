import { y } from "./side";
import { w } from "./wrap";
export const x = "real+" + y + "+" + w;
(globalThis as any).ran = ((globalThis as any).ran ?? "") + "k";

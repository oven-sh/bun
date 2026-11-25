export { value } from "./inner.ts";
export const own: string = "own " + (globalThis as any).ran;
(globalThis as any).barrel = ((globalThis as any).barrel ?? 0) + 1;

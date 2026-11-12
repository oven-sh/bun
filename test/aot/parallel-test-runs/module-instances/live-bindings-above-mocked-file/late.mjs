import { count, bump } from "./barrel.mjs";
await Promise.resolve();
export const atLoad = count;
export const after = bump();

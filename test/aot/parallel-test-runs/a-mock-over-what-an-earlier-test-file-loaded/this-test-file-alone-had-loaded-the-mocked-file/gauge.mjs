import { pull } from "./spring.mjs";
globalThis.turns = (globalThis.turns ?? 0) + 1;
export const read = () => pull;
export const kept = pull;

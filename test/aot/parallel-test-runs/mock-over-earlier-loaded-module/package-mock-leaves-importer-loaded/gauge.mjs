import { pull } from "@k123-made/spring";
globalThis.turns = (globalThis.turns ?? 0) + 1;
export const read = () => pull;
export const kept = pull;

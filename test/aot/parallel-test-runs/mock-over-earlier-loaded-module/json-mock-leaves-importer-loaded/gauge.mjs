import data from "./data.json";
globalThis.turns = (globalThis.turns ?? 0) + 1;
export const read = () => data.pull;
export const kept = data.pull;

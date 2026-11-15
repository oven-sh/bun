import { get } from "./part.mjs";
globalThis.runsOfUser = (globalThis.runsOfUser ?? 0) + 1;
export const seen = get();

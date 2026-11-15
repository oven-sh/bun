import { kind } from "./part.mjs";
globalThis.runsOfUses = (globalThis.runsOfUses ?? 0) + 1;
export const sees = () => kind;

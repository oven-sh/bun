globalThis.runsOfUses = (globalThis.runsOfUses ?? 0) + 1;
import { kind } from "./part.mjs";
export const sees = () => kind;

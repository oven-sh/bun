(globalThis.bodies ??= []).push("ledger");
import { side } from "./side.mjs";
import { gone } from "./legacy.cjs";
export const ledger = [gone, side];

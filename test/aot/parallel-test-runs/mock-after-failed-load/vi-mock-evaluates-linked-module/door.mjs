globalThis.bodies = (globalThis.bodies ?? 0) + 1;
import { first } from "./first.mjs";
import { between } from "./between.mjs";
import { tally } from "./tally.mjs";
export const door = [first, between, tally];

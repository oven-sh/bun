globalThis.ran = (globalThis.ran ?? '') + 'd';
import { tally } from "./tally.mjs";
import { between } from "./between.mjs";
export const door = [between, tally];

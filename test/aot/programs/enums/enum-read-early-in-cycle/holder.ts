import { Level } from "./levels";
export const held = { levels: Level };
export function read(): string { return typeof held.levels; }

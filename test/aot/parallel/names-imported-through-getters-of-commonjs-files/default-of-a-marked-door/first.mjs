import level, { raise } from "./gauge.cjs";
export function poke() { raise(); }
export function read() { return level; }

import { name, swap } from "./gauge.cjs";
export function poke() { swap(); }
export function read() { return name(); }

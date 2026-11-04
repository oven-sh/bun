import { probe, twice, kinds, arms, loop } from "./main.mjs";
export { Box } from "./c.mjs";
export let count = 1;
export function setCount(n) { count = n; }
function attempt(f) { try { return f(); } catch (e) { return e.name; } }
export const early = [probe, twice, kinds, between => arms(false, between), between => arms(true, between), between => loop(2, between)].map(f => attempt(() => f(() => {})));

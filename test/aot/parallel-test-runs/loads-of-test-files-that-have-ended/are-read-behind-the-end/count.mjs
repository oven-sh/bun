globalThis.loads = (globalThis.loads ?? 0) + 1;
export const load = globalThis.loads;
export let turns = 0;
export const turn = () => ++turns;
export default () => `load ${load}, ${turns} turns`;

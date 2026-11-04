export let x = 5;
if (globalThis.neverSet) x = 6;
export const read = () => x;

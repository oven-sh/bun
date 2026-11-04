export let x;
if (globalThis.neverSet) x = 5; else x = 6;
export const read = () => x;

globalThis.prices = (globalThis.prices ?? 0) + 1;
const run = globalThis.prices;
let turns = 0;
export const price = () => `price run ${run}, turn ${++turns}`;

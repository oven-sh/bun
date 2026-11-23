globalThis.costs = (globalThis.costs ?? 0) + 1;
const run = globalThis.costs;
let turns = 0;
exports.cost = () => `cost run ${run}, turn ${++turns}`;

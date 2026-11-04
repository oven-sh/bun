globalThis.runsOfDep = (globalThis.runsOfDep ?? 0) + 1;
console.log("dep runs", globalThis.runsOfDep);
export let count = 0;
export const step = () => ++count;

globalThis.runs = (globalThis.runs ?? 0) + 1;
export const word = "real" + globalThis.runs;
export default class { static w = word; }

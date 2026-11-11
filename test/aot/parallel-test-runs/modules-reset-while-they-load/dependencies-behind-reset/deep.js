globalThis.runs ??= {}; globalThis.runs.deep = (globalThis.runs.deep ?? 0) + 1;
export const run = globalThis.runs.deep;
export const sees = [].join();

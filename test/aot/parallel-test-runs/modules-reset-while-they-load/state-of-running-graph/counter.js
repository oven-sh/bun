globalThis.runs ??= {}; globalThis.runs.counter = (globalThis.runs.counter ?? 0) + 1;
export const run = globalThis.runs.counter;
export const sees = [].join();

globalThis.runs ??= {}; globalThis.runs.pkg = (globalThis.runs.pkg ?? 0) + 1;
export const run = globalThis.runs.pkg;
export const sees = [].join();

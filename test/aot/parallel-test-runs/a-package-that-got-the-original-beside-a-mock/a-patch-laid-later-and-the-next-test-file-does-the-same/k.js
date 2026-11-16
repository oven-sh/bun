globalThis.runs = (globalThis.runs ?? 0) + 1;
export const x = "real " + globalThis.runs;

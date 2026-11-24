globalThis.runs = (globalThis.runs ?? "") + "part "; if (!globalThis.failed) { globalThis.failed = true; throw new Error("part fails"); } export const x = "real";

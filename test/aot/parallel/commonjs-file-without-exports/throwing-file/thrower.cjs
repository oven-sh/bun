globalThis.runs = (globalThis.runs ?? 0) + 1;
throw new Error("run " + globalThis.runs);

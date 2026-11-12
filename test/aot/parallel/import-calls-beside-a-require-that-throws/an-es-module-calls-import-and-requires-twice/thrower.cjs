globalThis.runs = (globalThis.runs ?? 0) + 1;
throw new Error("thrown by run " + globalThis.runs);

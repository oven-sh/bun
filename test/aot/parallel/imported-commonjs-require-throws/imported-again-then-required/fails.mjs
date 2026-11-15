globalThis.fails = (globalThis.fails ?? 0) + 1;
throw new Error("no " + globalThis.fails);

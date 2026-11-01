globalThis.timesThrown = (globalThis.timesThrown ?? 0) + 1;
throw new Error("thrown by the module");

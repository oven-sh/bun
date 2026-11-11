globalThis.ranBreaks = (globalThis.ranBreaks ?? 0) + 1;
throw new Error("the real file " + globalThis.ranBreaks);

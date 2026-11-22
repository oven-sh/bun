globalThis.ranBreaks = (globalThis.ranBreaks ?? 0) + 1;
if (globalThis.ranBreaks === 1) throw new Error("the real file");
export const round = 1;

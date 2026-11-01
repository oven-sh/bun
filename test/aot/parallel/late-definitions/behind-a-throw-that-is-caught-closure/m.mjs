let v;
try { if (!globalThis.neverSet) throw new Error("stop"); v = function () { return 1; }; } catch {}
export const read = () => v;

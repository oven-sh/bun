let v;
try { if (!globalThis.neverSet) throw new Error("stop"); v = /x/g; } catch {}
export const read = () => v;

let v;
try { if (!globalThis.neverSet) throw new Error("stop"); v = () => 1; } catch {}
export const read = () => v;

let v;
try { if (!globalThis.neverSet) throw new Error("stop"); v = class { m() { return 1; } }; } catch {}
export const read = () => v;

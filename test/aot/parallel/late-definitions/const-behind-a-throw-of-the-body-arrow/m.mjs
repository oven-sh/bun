globalThis.leaked = () => { try { return typeof v; } catch (e) { return e.name; } };
if (!globalThis.neverSet) throw new Error("stop");
const v = () => 1;
export const read = () => v;

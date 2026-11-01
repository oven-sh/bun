let v;
if (globalThis.neverSet) v = class { m() { return 1; } };
export const read = () => v;

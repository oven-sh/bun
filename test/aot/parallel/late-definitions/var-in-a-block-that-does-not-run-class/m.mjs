if (globalThis.neverSet) { var v = class { m() { return 1; } }; }
export const read = () => v;

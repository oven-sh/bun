let v;
if (globalThis.neverSet) v = () => 1;
export const read = () => v;

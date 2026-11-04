let v;
if (globalThis.neverSet) v = function () { return 1; };
export const read = () => v;

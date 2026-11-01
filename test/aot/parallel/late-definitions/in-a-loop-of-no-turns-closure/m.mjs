let v;
for (let i = 0; i < (globalThis.neverSet ? 1 : 0); i++) v = function () { return 1; };
export const read = () => v;

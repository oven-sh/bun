globalThis.runs = (globalThis.runs ?? 0) + 1;
let n = 0;
export const bump = () => ++n;
export const count = () => n;

globalThis.runs = (globalThis.runs ?? 0) + 1;
const at = globalThis.runs;
export const get = () => "real";
export const other = () => "real" + at;

export function make(c, e) { return c ? { data: 1 } : { error: e }; }
export const made = make(true, 1);

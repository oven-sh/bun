const pattern = /a+/g;
export function same(n) { let first = null, count = 0; for (let i = 0; i < n; i++) { const now = pattern; if (first === null) first = now; if (first === now) count++; } return count; }
export const read = () => pattern;

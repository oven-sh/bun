const seen = new Set();
export const all = seen;
export const make = () => ({ n: 1, f: function g() { seen.add(g); return seen.size; } });

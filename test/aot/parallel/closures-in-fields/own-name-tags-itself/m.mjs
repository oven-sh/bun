export const make = () => ({ n: 1, f: function g() { g.count = (g.count || 0) + 1; return g.count; } });

export const make = () => ({ n: 1, f: function g(k) { return k ? k + g(k - 1) : 0; } });

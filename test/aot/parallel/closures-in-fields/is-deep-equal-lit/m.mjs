export const make = () => ({ n: 1, add: (a, b) => a + b, sub: function (a, b) { return a - b; }, me() { return this.n; } });

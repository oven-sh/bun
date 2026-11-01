export const make = () => ({ n: 1, f: function g() { return [g === this.f, this.n].join(); } });

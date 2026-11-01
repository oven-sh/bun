export const make = () => ({ n: 1, toJSON: function g() { g.hits = (g.hits || 0) + 1; return { n: this.n }; }, then: undefined });

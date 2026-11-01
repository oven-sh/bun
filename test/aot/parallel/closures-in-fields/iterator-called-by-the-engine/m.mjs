export const make = () => ({ n: 1, [Symbol.iterator]: function* g() { g.hits = (g.hits || 0) + 1; yield 1; }, next: function h() { return { done: true }; } });

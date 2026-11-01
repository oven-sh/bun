export const make = () => ({ n: 1, g: function* gen() { yield gen; }, a: async function asy() { return asy; } });

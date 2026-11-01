export const make = () => ({ n: 1, K: function K() { this.same = new.target === K; this.ctor = K; } });

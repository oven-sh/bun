class K { n = 1; add = (a, b) => a + b; get = () => this.n; }
export const make = () => new K();

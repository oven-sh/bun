class K { n = 1; f = function g() { return g; }; me = () => this.me; }
export const make = () => new K();

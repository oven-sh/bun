class K { n = 1; constructor(other) { this.get = () => other.n; } }
export const make = () => new K({ n: 7 });

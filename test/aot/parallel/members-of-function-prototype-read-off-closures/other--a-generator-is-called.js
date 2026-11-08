function* f(a) { yield this.k + a; }
console.log(f.call({ k: 1 }, 2).next().value);

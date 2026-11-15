module.exports = class Counter {
  constructor() { this.n = 0; }
  add(i) { this.n += i; return this; }
};

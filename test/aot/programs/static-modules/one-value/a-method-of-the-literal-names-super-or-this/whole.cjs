module.exports = {
  n: 4,
  above() { return super.hasOwnProperty("n"); },
  own() { return this.n; },
};

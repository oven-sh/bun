module.exports = {
  grind(n) {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return "real " + (n + work);
  },
  sift(n) { return "sifted " + n; },
};

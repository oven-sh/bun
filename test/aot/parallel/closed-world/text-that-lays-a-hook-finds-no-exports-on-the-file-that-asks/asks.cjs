exports.sum = function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
};
exports.ask = function ask(name) {
  return require.resolve(name);
};

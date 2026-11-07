exports.grind = function grind(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return "real " + (n + work);
};
exports.twice = function twice(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return exports.grind(n) + " + " + exports.grind(n + work);
};

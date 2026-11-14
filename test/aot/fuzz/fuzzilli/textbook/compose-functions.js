function composed(...steps) {
  return function (value) {
    for (const step of steps) value = step(value);
    return value;
  };
}
function double(n) {
  return n * 2;
}
function increment(n) {
  return n + 1;
}
console.log(composed(double, increment, double)(5));

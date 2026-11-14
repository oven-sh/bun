function curried(work, count) {
  return function take(...given) {
    return given.length >= count ? work(...given) : (...more) => take(...given, ...more);
  };
}
function volume(a, b, c) {
  return a * b * c;
}
console.log(curried(volume, 3)(2)(3)(4), curried(volume, 3)(2, 3)(4));

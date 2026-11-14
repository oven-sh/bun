// The older `__esm`: a function that threw is not run again, and later calls return without an error.
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var value,
  runs = 0;
var init_bad = __esm(() => {
  runs++;
  value = "early";
  throw new Error("no");
});
var attempt = () => {
  try {
    init_bad();
    return value;
  } catch (error) {
    return error.message;
  }
};
console.log(attempt(), attempt(), attempt(), runs);

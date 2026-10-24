// Bun's `__esm`: what the function throws is kept and thrown by every later call.
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};
var runs = 0;
var init_bad = __esm(() => {
  runs++;
  throw new Error("no");
});
var attempt = () => {
  try {
    init_bad();
  } catch (error) {
    return error;
  }
};
console.log(attempt() === attempt(), runs);

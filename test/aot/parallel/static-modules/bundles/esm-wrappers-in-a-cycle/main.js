// Two `__esm` wrappers that call each other: the second call of the first returns at once, and the variables hold what has been stored so far.
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var early, late;
var init_a = __esm(() => {
  early = 1;
  init_b();
  late = 2;
});
var saw;
var init_b = __esm(() => {
  init_a();
  saw = early + ":" + late;
});
init_a();
console.log(saw, early + ":" + late);

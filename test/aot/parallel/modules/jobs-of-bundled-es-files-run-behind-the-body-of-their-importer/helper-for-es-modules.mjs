var __esm = (fn, res) => () => (fn && (res = fn((fn = 0))), res);
var x;
var init_inner = __esm(() => {
  x = 7;
});
init_inner();
console.log("body: the helper for ES modules", x);
Promise.resolve().then(() => console.log("job: the helper for ES modules"));
export { x };

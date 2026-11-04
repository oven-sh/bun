var __esm = (fn, res, err) => () => {
if (fn)
try {
res = fn((fn = 0));
} catch (e) {
err = [e];
}
if (err) throw err[0];
return res;
};
var x;
var init_inner = __esm(() => {
  x = function () { return 7; };
});
init_inner();
export { x };

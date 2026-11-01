var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
if (err) throw err[0];
try {
return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
} catch (e) {
throw err = [e], e;
}
};
var x;
var init_inner = __esm({
  "src/inner.js"() {
    x = function () { return 7; };
  }
});
init_inner();
export { x };

// @bun
var t = (s, e) => () => (e || s((e = { exports: {} }).exports, e), e.exports);
var n = t(function (l, r) {
  r.exports = 7;
});
var c = n(),
  o = c;
Promise.resolve().then(() => console.log("a job of the minified owner.mjs"));
export { o };

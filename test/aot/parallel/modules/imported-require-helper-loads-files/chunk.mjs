export var __require = /* @__PURE__ */ (x =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(x, {
          get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
        })
      : x)(function (x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var t = (a =>
  typeof require < "u"
    ? require
    : typeof Proxy < "u"
      ? new Proxy(a, {
          get: (b, c) => (typeof require < "u" ? require : b)[c],
        })
      : a)(function (a) {
  if (typeof require < "u") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + a + '" is not supported');
});
export { t as c };

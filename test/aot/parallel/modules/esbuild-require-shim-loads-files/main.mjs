// esbuild writes `__require("name")` for a CommonJS require() of a package that is marked external. The files have to be in the executable like the ones that a plain require() names.
var __require = /* @__PURE__ */ (x =>
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
var t=(a=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(a,{get:(b,c)=>(typeof require<"u"?require:b)[c]}):a)(function(a){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+a+'" is not supported')});

console.log(__require("external-package").name, __require("./inside.cjs"), t("./inside.cjs"), t("external-package/package.json").version);
console.log(__require("./inside.cjs") === require("./inside.cjs"), __require === require, typeof __require.resolve("./inside.cjs"));
try {
  __require("./missing.cjs");
} catch (error) {
  console.log(error.code);
}
console.log(early());
function early() {
  try {
    return late("./inside.cjs");
  } catch (error) {
    return error.constructor.name;
  }
}
var late = (() => require)();
console.log(late("./inside.cjs"));

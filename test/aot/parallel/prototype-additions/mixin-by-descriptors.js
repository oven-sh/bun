Object.defineProperties(
  Promise.prototype,
  Object.getOwnPropertyDescriptors({
    get extra() {
      return 41;
    },
    twice() {
      return 82;
    },
  }),
);
const mixin = {
  get source2() {
    return "from a variable";
  },
};
Object.defineProperties(RegExp.prototype, Object.getOwnPropertyDescriptors(mixin));
Object.defineProperties(Function.prototype, Object.getOwnPropertyDescriptors({ tag: "f" }));
Object.defineProperties(
  URL.prototype,
  Object.getOwnPropertyDescriptors({
    get shout() {
      return this.host.toUpperCase();
    },
  }),
);
const promise = Promise.resolve(1);
console.log("" + promise.extra, "" + promise.twice(), "" + /a/.source2, "" + (() => 1).tag);
console.log("" + new URL("http://a.b/").shout);

// The polyfill idiom: `??=` and `||=` store a name that is not there, and leave a member that is there alone.
Promise.prototype.extra ??= function () {
  return "promise";
};
RegExp.prototype.extra ||= function () {
  return "regexp";
};
Function.prototype["quoted"] ??= function () {
  return "function";
};
URL.prototype.extra ??= function () {
  return "url";
};
const then = Promise.prototype.then;
Promise.prototype.then ??= function () {
  return "never";
};
Promise.prototype.extra ??= function () {
  return "second";
};
console.log(Promise.resolve(1).extra(), /a/.extra(), (() => {}).quoted(), new URL("http://a.b/").extra());
console.log(Promise.prototype.then === then);

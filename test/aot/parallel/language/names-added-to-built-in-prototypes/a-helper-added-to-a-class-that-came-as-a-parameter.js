// As the package url-polyfill does: it finds the built-in class through a parameter and gives its prototype a helper, so the build sees neither the object nor that it is written.
(function (global) {
  var proto = global.URLSearchParams.prototype;
  if (typeof proto._fromString !== "function") Object.defineProperty(proto, "_fromString", { value(text) { return text; } });
  if (typeof proto.sort !== "function") proto.sort = function () {};
})(typeof global !== "undefined" ? global : globalThis);
console.log(new URLSearchParams()._fromString("a"), Object.keys(URLSearchParams.prototype).includes("_fromString"), typeof URLSearchParams.prototype.sort);
/* Output:
a false function
*/

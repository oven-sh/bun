function collect(a, b) {
  arguments[0] = 9;
  return [a, arguments.length, Array.prototype.slice.call(arguments).join()];
}
console.log("required", collect(1, 2, 3).join(" "), (function () { return this === undefined; })());

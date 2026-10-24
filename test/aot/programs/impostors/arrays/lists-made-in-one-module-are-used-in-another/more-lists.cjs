module.exports = {
  set: function () { return new Set([3, 1, 2]); },
  typed: function () { return new Uint8Array([3, 1, 200]); },
  mappedArguments: function () { return (function (a, b, c) { a = 30; return arguments; })(3, 1, 2); },
  nothing: function () { return null; },
  parsed: function () { return JSON.parse('{"0":3,"1":1,"length":2}'); },
  relinked: function () { return Object.setPrototypeOf([3, 1, 2], null); },
};

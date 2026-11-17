globalThis.modes.push([
  globalThis.asked,
  (function () {
    return this === undefined;
  })(),
  typeof this,
  (function (a) {
    arguments[0] = 2;
    return a;
  })(1),
]);

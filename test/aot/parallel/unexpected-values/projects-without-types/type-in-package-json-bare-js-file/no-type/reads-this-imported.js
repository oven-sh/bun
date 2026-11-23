globalThis.modes.push([
  globalThis.asked,
  typeof this,
  (function () {
    return this === undefined;
  })(),
  (function (a) {
    arguments[0] = 2;
    return a;
  })(1),
]);

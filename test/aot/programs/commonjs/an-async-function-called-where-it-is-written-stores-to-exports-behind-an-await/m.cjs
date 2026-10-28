exports.done = (async function () {
  exports.a = 1;
  await null;
  exports.b = 2;
})();

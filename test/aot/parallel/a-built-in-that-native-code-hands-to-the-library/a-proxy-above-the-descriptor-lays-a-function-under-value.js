// What stands above the descriptor runs while the descriptor is read and lays a function under `value`, where a number is written: `process` is handed to that function, so it is let go.
// STATISTIC: ImageFunctionsEmitted >= 1000
(function () {
  const d = { value: 7, writable: process.argv.length > 99 };
  d.__proto__ = new Proxy({}, {
    has(target, key) { return key === "enumerable"; },
    get(target, key, receiver) { receiver.value = function () { return this; }; return false; },
  });
  Object.defineProperty(process, "madeUp", d);
})();
console.log("SAID", typeof process.madeUp);

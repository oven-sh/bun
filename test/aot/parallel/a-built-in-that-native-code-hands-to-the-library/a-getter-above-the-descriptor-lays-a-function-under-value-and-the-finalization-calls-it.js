// The descriptor holds a number under `value`, and a getter above it, which runs while the descriptor is read, lays a function there: `process.on` is that function, and native code hands it `process`.
(function () {
  const d = { value: 7, writable: process.argv.length > 99 };
  d.__proto__ = { get enumerable() { this.value = function (event) { console.log(event, typeof this.allowedNodeEnvironmentFlags.has); return this; }; return false; } };
  Object.defineProperty(process, "on", d);
})();
process.finalization.register({}, () => {});

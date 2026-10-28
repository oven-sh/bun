exports.two = 2;
queueMicrotask(() => {
  exports.one = "late";
});

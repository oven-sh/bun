exports.two = 2;
queueMicrotask(() => {
  console.log("the microtask runs");
  exports.one = "late";
});

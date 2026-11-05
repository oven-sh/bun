// What a CommonJS entry point exports is read when the file has run, not when its `then` is called.
Object.defineProperty(exports, "answer", {
  enumerable: true,
  get() {
    console.log("a getter is read");
    return 42;
  },
});
exports.then = function (resolve) {
  console.log("the first then is called");
  resolve();
};
queueMicrotask(() => {
  exports.then = function (resolve) {
    console.log("the second then is called");
    resolve();
  };
  console.log("a microtask");
});
console.log("ran");

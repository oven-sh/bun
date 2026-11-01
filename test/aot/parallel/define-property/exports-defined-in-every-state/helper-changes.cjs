module.exports = function (target) {
  target.taken = "theirs";
  Object.defineProperty(target, "getter", { value: "theirs" });
  Object.defineProperty(target, "extra", { value: "theirs", enumerable: true });
};

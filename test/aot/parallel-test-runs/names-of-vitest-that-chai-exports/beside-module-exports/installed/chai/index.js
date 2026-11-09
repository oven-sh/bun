exports.assert = {
  ok(value) {
    if (!value) throw new Error("not ok");
  },
};
exports.should = () => {};

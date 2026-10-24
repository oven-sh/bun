exports.kept = [];
exports.take = function (t) {
  return t.n;
};
exports.make = function (n) {
  return { n, tag: "made in common " + n };
};

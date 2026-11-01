var Kind;
(function (Kind) {
  Kind[Kind["toString"] = 0] = "toString";
  Kind[Kind["valueOf"] = 1] = "valueOf";
  Kind[Kind["plain"] = 2] = "plain";
})(Kind || (Kind = {}));
exports.read = () => Kind;

class Basket {
  size() {
    return 3;
  }
}
const outcome = (function () {
  const idle = () => new Basket().size();
  return 4;
})();
exports.live = () => outcome;

class Basket {
  #held = 4;
  size() {
    return this.#held;
  }
}
let live;
live = function () {
  class Idle {
    run() {
      return new Basket().size();
    }
  }
  return 3;
};
exports.live = live;

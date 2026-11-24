class Basket {
  static most = 5;
  size() {
    return Basket.most;
  }
}
class Host {
  static {
    (() => {
      function idle() {
        return new Basket().size();
      }
    })();
  }
  static live() {
    return "ok";
  }
}
module.exports = Host;

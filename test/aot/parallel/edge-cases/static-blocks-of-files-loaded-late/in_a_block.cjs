class Basket {
  size() {
    return 3;
  }
}
class Host {
  static {
    this.live = () => {
      const idle = () => new Basket().size();
      return "ok";
    };
  }
}
module.exports = Host;

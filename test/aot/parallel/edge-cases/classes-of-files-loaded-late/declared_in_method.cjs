class Basket {
  static made = 2;
  size() {
    return Basket.made;
  }
}
module.exports = {
  live() {
    function idle() {
      return new Basket().size();
    }
    const never = () => idle();
    return 2;
  },
};

class Basket {
  size() {
    return 3;
  }
}
module.exports = {
  live() {
    const idle = () => new Basket().size();
    return 1;
  },
};

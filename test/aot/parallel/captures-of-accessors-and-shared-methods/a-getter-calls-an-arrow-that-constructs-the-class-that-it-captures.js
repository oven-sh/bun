function make() {
  class Point {}
  class Model {
    get current() {
      const inner = () => new Point();
      return inner();
    }
  }
  return new Model().current;
}
console.log(typeof make(), make().constructor.name);

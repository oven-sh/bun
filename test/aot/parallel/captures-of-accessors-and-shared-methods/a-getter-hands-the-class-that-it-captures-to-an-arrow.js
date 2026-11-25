function make() {
  class Point {}
  class Model {
    get current() {
      return () => Point;
    }
  }
  return new Model().current;
}
console.log(make()().name, make()() === make()());

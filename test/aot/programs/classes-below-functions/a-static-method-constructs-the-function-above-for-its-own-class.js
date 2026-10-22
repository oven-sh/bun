function Base() {
  this.value = { inner: 1 };
}
class Below extends Base {
  static make() {
    return Reflect.construct(Base, [], this);
  }
  set value(stored) {}
}
class Lowest extends Below {}
console.log(typeof Below.make().value, typeof Lowest.make().value, Lowest.make() instanceof Lowest);

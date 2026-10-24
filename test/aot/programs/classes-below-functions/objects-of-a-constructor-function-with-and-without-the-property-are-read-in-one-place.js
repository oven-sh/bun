function Base() {
  this.value = { inner: 1 };
}
class Below extends Base {
  set value(stored) {}
}
function read(object) {
  return object.value;
}
const list = [new Base(), Reflect.construct(Base, [], Below), new Base()];
console.log(list.map(object => typeof read(object)).join(), list.map(object => read(object)?.inner).join());

// new.target is the class below, so the object inherits the setter, and the store in the function makes no property of the object.
function Base() {
  this.value = { inner: 1 };
}
class Below extends Base {
  set value(stored) {}
}
const made = Reflect.construct(Base, [], Below);
console.log(typeof made.value, made.value?.inner, Object.keys(made).join() || "-", made instanceof Below);
console.log(new Base().value.inner, typeof new Below().value);

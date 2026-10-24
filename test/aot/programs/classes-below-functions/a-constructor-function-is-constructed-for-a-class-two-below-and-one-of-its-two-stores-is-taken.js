function Base() {
  this.taken = { inner: 1 };
  this.kept = { inner: 2 };
}
class Middle extends Base {
  set taken(stored) {}
}
class Below extends Middle {}
const made = Reflect.construct(Base, [], Below);
console.log(typeof made.taken, made.kept.inner, Object.keys(made).join(), made instanceof Below);

function work(value) {
  return value + 1;
}
console.log(new WeakRef(work).deref()(1.5));

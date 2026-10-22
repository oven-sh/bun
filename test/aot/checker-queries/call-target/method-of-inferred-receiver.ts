// The checker inferred the receiver's type argument, so nobody wrote it: the written result of the call stays the type parameter.
class Box<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  get(): T { return this.value; }
}
const box = new Box(1);
box.get();

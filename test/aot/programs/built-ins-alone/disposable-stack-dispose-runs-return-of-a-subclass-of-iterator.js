class Numbers extends Iterator {
  closed = 0;
  next() {
    return { done: true, value: undefined };
  }
  return() {
    this.closed++;
    console.log("return", this.closed);
    return {};
  }
}
const numbers = new Numbers();
const stack = new DisposableStack();
stack.use(numbers);
stack.dispose();
console.log(numbers.closed);

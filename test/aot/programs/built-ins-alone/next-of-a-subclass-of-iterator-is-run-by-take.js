class Numbers extends Iterator {
  count = 0;
  next() {
    this.count++;
    console.log("next", this.count);
    return this.count > 3 ? { done: true, value: undefined } : { done: false, value: this.count + 0.5 };
  }
  return() {
    console.log("return");
    return { done: true, value: undefined };
  }
}
console.log([...new Numbers().take(2)].join());

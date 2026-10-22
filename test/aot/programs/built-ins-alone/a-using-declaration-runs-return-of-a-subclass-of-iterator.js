class Numbers extends Iterator {
  next() {
    return { done: true, value: undefined };
  }
  return() {
    console.log("return");
    return {};
  }
}
{
  using numbers = new Numbers();
  console.log(typeof numbers);
}

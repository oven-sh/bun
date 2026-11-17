function* numbers() {
  try {
    yield 1;
    yield 2;
  } finally {
    console.log("closed");
  }
}
{
  using walk = numbers();
  console.log(walk.next().value);
}
console.log("behind the block");

async function* numbers() {
  try {
    yield 1;
  } finally {
    console.log("closed");
  }
}
{
  await using walk = numbers();
  console.log((await walk.next()).value);
}
console.log("behind the block");

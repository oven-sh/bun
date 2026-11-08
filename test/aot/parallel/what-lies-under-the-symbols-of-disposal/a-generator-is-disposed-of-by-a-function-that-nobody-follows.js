function* numbers() {
  try {
    yield 1;
  } finally {
    console.log("closed");
  }
}
const end = [value => value[Symbol.dispose]()][JSON.parse("0")];
const walk = numbers();
walk.next();
end(walk);
console.log("behind");

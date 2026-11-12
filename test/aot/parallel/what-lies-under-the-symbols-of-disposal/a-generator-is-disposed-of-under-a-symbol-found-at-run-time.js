function* numbers() {
  try {
    yield 1;
  } finally {
    console.log("closed");
  }
}
const walk = numbers();
walk.next();
walk[Symbol[JSON.parse(`"dispose"`)]]();
console.log("behind");

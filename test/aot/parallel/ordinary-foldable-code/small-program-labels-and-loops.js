const SIZE = 4;
const TARGET = 6;
let found = null;
outer: for (let i = 1; i <= SIZE; i++) {
  for (let j = 1; j <= SIZE; j++) {
    if (i * j === TARGET) {
      found = [i, j];
      break outer;
    }
  }
}
console.log(found);

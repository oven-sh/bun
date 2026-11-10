function counter() {
  let count = 0;
  return function () {
    count++;
    return count;
  };
}
const next = counter();
const other = counter();
console.log(next(), next(), other(), next());

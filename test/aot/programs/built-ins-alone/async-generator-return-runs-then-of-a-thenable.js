async function* numbers() {
  yield 1;
}
const thenable = {
  count: 0,
  then(resolve) {
    this.count++;
    resolve(1.5);
  },
};
console.log((await numbers().return(thenable)).value + 1, thenable.count);

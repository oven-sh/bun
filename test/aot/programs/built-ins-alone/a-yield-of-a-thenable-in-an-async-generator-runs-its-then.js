const thenable = {
  count: 0,
  then(resolve) {
    this.count++;
    resolve(1.5);
  },
};
async function* numbers() {
  yield thenable;
}
console.log((await numbers().next()).value + 1, thenable.count);

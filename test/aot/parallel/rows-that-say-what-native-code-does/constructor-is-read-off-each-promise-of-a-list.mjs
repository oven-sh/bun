// Promise.all reads `constructor` off each promise of its list, which is a getter of the program here.
let asked = 0;
function run() {
  const promise = Promise.resolve(1);
  Object.defineProperty(promise, "constructor", {
    get() {
      asked++;
      return Promise;
    },
  });
  return Promise.all([promise]);
}
await run();
console.log(asked > 0);

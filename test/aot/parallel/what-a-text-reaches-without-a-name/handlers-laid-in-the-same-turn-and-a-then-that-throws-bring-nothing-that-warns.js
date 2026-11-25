// Three rejections, each with its handler laid in the same turn: a rejected promise, a then that throws, an async function that throws. Native code reports none of them.
// STATISTIC: ImageFunctionsEmitted <= 14
const held = Promise.reject(new Error("held"));
held.catch(error => console.log("caught", error.message));
Promise.resolve(1)
  .then(() => {
    throw new Error("in a then");
  })
  .catch(error => console.log("caught", error.message));
async function fails() {
  throw new Error("async");
}
fails().then(undefined, error => console.log("caught", error.message));
console.log("end");

// A `then` that the main file exports is called once.
module.exports = {
  then(resolve) {
    console.log("then is called");
    resolve();
  },
};
console.log("ran");

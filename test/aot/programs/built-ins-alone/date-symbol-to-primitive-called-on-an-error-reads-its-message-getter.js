class Failure extends Error {
  get message() {
    console.log("message");
    return "it failed";
  }
}
console.log(Date.prototype[Symbol.toPrimitive].call(new Failure(), "string"));

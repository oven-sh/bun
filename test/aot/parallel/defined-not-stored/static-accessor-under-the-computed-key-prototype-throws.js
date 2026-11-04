try {
  class Holder { static get ["prototype"]() { return "a getter"; } }
  console.log("defined", typeof Holder.prototype);
} catch (error) {
  console.log(error.constructor.name);
}

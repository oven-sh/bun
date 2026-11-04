try {
  class Holder { static ["prototype"] = "a field"; }
  console.log("defined", typeof Holder.prototype);
} catch (error) {
  console.log(error.constructor.name);
}

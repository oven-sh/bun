if (typeof exports === "number") {
  console.log("again", exports, typeof this, String(this), (() => String(this))());
} else {
  console.log("first", this === exports);
  arguments.callee.call("receiver", 7);
}

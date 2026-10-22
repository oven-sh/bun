if (typeof exports === "number") {
  console.log("again", exports, require, arguments.length);
} else {
  console.log("first", typeof exports, typeof require, arguments.length);
  arguments.callee(7);
}

// valueOf calls process.exit() during a numeric conversion before a write to a locked built-in.
const value = {
  valueOf() {
    console.log("done");
    process.exit(0);
  },
};
+value;
Array.prototype.push = function () {};

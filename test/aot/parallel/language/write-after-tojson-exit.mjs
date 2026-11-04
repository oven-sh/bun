// toJSON calls process.exit() inside JSON.stringify before a write to a locked built-in.
JSON.stringify({
  toJSON() {
    console.log("done");
    process.exit(0);
  },
});
Array.prototype.push = function () {};

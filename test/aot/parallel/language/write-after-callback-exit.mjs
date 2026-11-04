// A callback passed to a built-in calls process.exit() before a write to a locked built-in.
[1].forEach(() => {
  console.log("done");
  process.exit(0);
});
Array.prototype.push = function () {};

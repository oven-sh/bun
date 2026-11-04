// A property read of null always throws, so a write to a locked built-in after it is unreachable and is not reported.
process.on("uncaughtException", error => {
  console.log("caught", error.name);
});
const nothing = null;
console.log(nothing.length);
Array.prototype.push = function () {};

// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
process.on("uncaughtException", error => {
  console.log("caught", error.name);
});
const found = "abc".match(/x/);
console.log(found.length);
Array.prototype.push = function () {};
/* Output:
caught TypeError
*/

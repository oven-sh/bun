// A CommonJS file requires an ES module that calls import() of the file, and throws. A timer requires the file again and lists what it gets.
try {
  require("./file.cjs");
} catch (error) {
  console.log("main: require threw", error.message);
}
setTimeout(() => console.log("timer: required", Object.keys(require("./file.cjs")).join()), 5);
/* Output:
main: require threw thrown by the file
module: imported default,value
timer: required value
*/

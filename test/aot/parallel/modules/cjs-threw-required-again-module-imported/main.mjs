// A CommonJS file requires an ES module that imports the file, and throws. A timer requires the file again.
try {
  require("./file.cjs");
} catch (error) {
  console.log("main: require threw", error.message);
}
setTimeout(() => {
  try {
    console.log("timer: required", require("./file.cjs").value);
  } catch (error) {
    console.log("timer: require threw", error.message);
  }
}, 5);

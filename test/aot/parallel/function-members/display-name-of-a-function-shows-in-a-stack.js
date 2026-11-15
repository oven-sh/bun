// The run time reads `displayName` off the function object.
function thrower() {
  throw new Error("x");
}
thrower.displayName = "Shown";
try {
  thrower();
} catch (error) {
  console.log(error.stack.split("\n")[1].trim().split(" ")[1], thrower.displayName);
}

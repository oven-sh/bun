// Two such files in front of the statement that asks for the name.
console.log("main begins");
try {
  await import("./top.mjs");
} catch (error) {
  console.log(error.constructor.name);
}
console.log("main ends");

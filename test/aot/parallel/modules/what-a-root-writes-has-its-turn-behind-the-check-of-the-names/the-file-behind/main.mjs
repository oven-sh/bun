// As the-file-in-front, the two statements in the other order.
console.log("main begins");
try {
  await import("./top.mjs");
} catch (error) {
  console.log(error.constructor.name);
}
console.log("main ends");

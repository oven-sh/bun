// require() runs a module whose import is a cycle of two. One member calls import() on the other, whose body has ended, and then throws: the promise is rejected with what it threw.
// Todo: The executable prints that the promise is fulfilled. The table says that a member is evaluated when its own body has ended, and the failure of its cycle does not reach the import().
try {
  require("./imports-cycle.mjs");
} catch (error) {
  console.log("require threw:", error.message);
}
console.log("main ends");
export {};

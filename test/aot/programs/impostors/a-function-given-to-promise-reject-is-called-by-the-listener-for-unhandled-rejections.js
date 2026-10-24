process.once("unhandledRejection", f => {
  console.log("the listener calls it:", f(1));
});
Promise.reject(x => x + 1);

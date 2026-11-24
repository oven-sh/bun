// What native code has made and rejected with comes to the listener all the same.
// STATISTIC: ImageFunctionsEmitted <= 20
process.on("unhandledRejection", (reason, promise) => {
  console.log(reason instanceof Error, reason.name, typeof reason.message, reason.code, promise instanceof Promise);
});
Bun.file("/nowhere/at/all/" + JSON.parse("7")).text();

process.on("uncaughtException", error => {
  console.log(error instanceof ReferenceError ? "dead" : "other");
  process.exit(0);
});

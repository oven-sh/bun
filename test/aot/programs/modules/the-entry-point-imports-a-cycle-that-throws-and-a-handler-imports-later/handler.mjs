process.on("uncaughtException", error => {
  console.log("uncaught:", error.message);
  import("./later.mjs").then(
    () => console.log("import(later) resolves"),
    again => console.log("import(later) rejects:", again.message, again === error),
  );
});

process.on("unhandledRejection", (e) => {
  process.stderr.write("fatal: " + e.message + "\n", () => process.exit(1));
});
Promise.reject(new Error("boom"));

process.on("unhandledRejection", (e) => {
  process.nextTick(() => { console.error("tick ran"); process.exit(1); });
});
Promise.reject(new Error("boom"));

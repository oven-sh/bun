import("./last.cjs").then(last => {
  console.log("last is loaded:", last.default.name);
  lastHasRun();
});
Promise.resolve().then(() => console.log("job of late"));
console.log("late");
exports.name = "late";

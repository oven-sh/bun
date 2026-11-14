store.run("innermost", () => import("./last.mjs")).then(last => {
  see("last is loaded: " + last.name);
  lastHasRun();
});
Promise.resolve().then(() => see("job of late"));
see("late");
exports.name = "late";

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name, error.message);
  }
}
for (const [open, close] of [
  ["(?:", ")"],
  ["(?=", ")"],
]) {
  show("text that is a constant", () => new RegExp("(?:".repeat(150000) + "a" + ")".repeat(150000)).test("a"));
  show("text made at run time", () =>
    new RegExp(open.repeat(150000 + process.argv.length - process.argv.length) + "a" + close.repeat(150000)).test("a"),
  );
}
console.log("end");

// @bun
// Each line: the frame under a conversion that stands behind `undefined`, `NaN` or `Infinity` in a text that runs as it is written: the engine reads each as a name.
function fail() {
  throw new Error("fail");
}
function pass() {}
function show(label, run) {
  try {
    run();
    console.log(label, "no error");
  } catch (error) {
    const frames = String(error.stack).split("\n").slice(1, 4);
    console.log(label, "|", frames.map(line => /:(\d+:\d+)\)?$/.exec(line)?.[1]).join(" < "));
  }
}
show("undefined", () => {
  pass(undefined, `${{ toString: () => fail() }}`);
});
show("Infinity", () => {
  pass(Infinity, `${{ toString: () => fail() }}`);
});
show("NaN", () => {
  pass(NaN, `${{ toString: () => fail() }}`);
});
show("a statement", () => {
  undefined;
  return `${{ toString: () => fail() }}`;
});
show("a local name", () => {
  const undefined = 1;
  pass(undefined, `${{ toString: () => fail() }}`);
});
show("void 0", () => {
  pass(void 0, `${{ toString: () => fail() }}`);
});

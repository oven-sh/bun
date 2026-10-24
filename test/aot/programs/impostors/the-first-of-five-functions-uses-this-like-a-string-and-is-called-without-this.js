function firstCode() {
  return this.charCodeAt(0);
}
function two() {}
function three() {}
function four() {}
function five() {}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}
for (const use of [firstCode, two, three, four, five]) {
  console.log(use.name, "by call", attempt(() => use.call((0, eval)("'hello'"))));
  console.log(use.name, "with no this", attempt(() => use()));
}

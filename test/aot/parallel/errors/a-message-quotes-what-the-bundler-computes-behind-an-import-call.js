// Reference: bun build --compile
// Without --minify-syntax the bundler computes with constants behind an import() that it has come to, up to the end of the arguments of the call around it. A message quotes what the bundler has written.
function ask(work) {
  try {
    work();
    return "no throw";
  } catch (error) {
    return error.message;
  }
}
const run = work => work();
console.log("in front:", ask(() => (1 + 1).nope()));
run(() => {
  const load = () => import("node:os");
  console.log("in the same arguments:", ask(() => (1 + 1).nope()), typeof load);
});
console.log("behind the call:", ask(() => (1 + 1).nope()));
const load = () => import("node:os");
console.log("behind:", ask(() => (1 + 1).nope()), ask(() => (~1).nope()), typeof load);

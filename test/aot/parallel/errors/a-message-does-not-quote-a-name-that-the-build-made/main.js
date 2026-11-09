// The expansion of `import.meta.glob` stands in the tree under names that the build has made. No text of the program stands for such a name, so what holds it is not quoted whole,
// like a function with statements: docs/compiler/compatibility.mdx, "Error messages". Plain Bun prints another output: `bun run` quotes the names of its own expansion, a bundle those of the bundler.
const tell = (label, run) => {
  try {
    console.log(label + ":", String(run()));
  } catch (error) {
    console.log(label + ":", error.name, JSON.stringify(error.message));
  }
};
tell("eager", () => import.meta.glob("./parts/*.js", { eager: true }).nope());
tell("lazy", () => import.meta.glob("./parts/*.js").nope());
tell("eager, one name", () => import.meta.glob("./parts/*.js", { eager: true, import: "a" }).absent.deeper);
tell("eager, a member of a file", () => import.meta.glob("./parts/*.js", { eager: true })["./parts/one.js"].nope());
tell("the text of an arrow", () => () => import.meta.glob("./parts/*.js", { eager: true }));
/* Output:
eager: TypeError "nope is not a function. (In 'nope()', 'nope' is undefined)"
lazy: TypeError "nope is not a function. (In 'nope()', 'nope' is undefined)"
eager, one name: TypeError "undefined is not an object (evaluating 'undefined.deeper')"
eager, a member of a file: TypeError "nope is not a function. (In 'nope()', 'nope' is undefined)"
the text of an arrow: () => import.meta.glob("./parts/*.js", { eager: true })
*/

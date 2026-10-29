// A package that need not be installed: a module imports it by a static import and exports functions, classes and more; the program reaches that module only by loads that it guards.
const say = (how: string) => (error: any) => console.log(how, error.name, error.code, error.specifier);
await import("./exports-of-every-kind").then(it => console.log(it.one(), new it.Shape().area(), it.default(), it.Color.Red, it.space.inner()), say("import()"));
try {
  const required = require("./exports-of-every-kind");
  console.log(required.one());
} catch (error) {
  say("require")(error);
}
await import("./passes-them-on").then(it => console.log(it.one(), it.renamed()), say("through another module"));
console.log("goes on");

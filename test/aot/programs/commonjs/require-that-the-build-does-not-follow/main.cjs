// What the build does not follow to a file finds the entry points and no other file of the executable: `require` in a parameter, in a property or bound, whatever the path, and a path with no constant part, whoever is called.
const other = require("./other.cjs");
const load = require;
function attempt(title, action) {
  try {
    console.log(title, action());
  } catch (error) {
    console.log(title, "threw", error.constructor.name + ":", String(error.message).split("'")[0].trim());
  }
}
const unknown = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST || "./other.cjs";
attempt("a parameter:", () => (r => r("./other.cjs") === other)(require));
attempt("a property:", () => ({ load: require }).load("./other.cjs") === other);
attempt("bound:", () => require.bind(null)("./other.cjs") === other);
attempt("bound, under a name:", () => {
  const bound = require.bind(null);
  return bound("./other.cjs") === other;
});
attempt("a variable that is stored to:", () => {
  let changing = require;
  changing = load;
  return changing("./other.cjs") === other;
});
attempt("apply with a list from elsewhere:", () => {
  const list = ["./other.cjs"];
  return require.apply(null, list) === other;
});
attempt("a path nobody knows:", () => require(unknown) === other);
attempt("a path nobody knows, another name:", () => load(unknown) === other);
attempt("a path nobody knows, module.require:", () => module.require(unknown) === other);
attempt("the entry point is found:", () => (r => r(__filename) === module.exports)(require));
attempt("a built-in module is found:", () => typeof (r => r("node:path"))(require).join);

// "bun:os" names node:os for the transpiler alone, which reads the names of calls of `require` as it is written. Under another name the loader is asked, and finds no module.
const say = (what, load) => {
  try {
    console.log(what, typeof load().EOL);
  } catch (error) {
    console.log(what, error.code);
  }
};
say("written", () => require("bun:os"));
say("behind a comma", () => (0, require)("bun:os"));
say("of the module", () => module.require("bun:os"));
say("another name", () => {
  const load = require;
  return load("bun:os");
});
const top = require;
say("at the top", () => top("bun:os"));
say("given", () => (load => load("bun:os"))(require));
say("a name that the loader knows", () => top("node:os"));

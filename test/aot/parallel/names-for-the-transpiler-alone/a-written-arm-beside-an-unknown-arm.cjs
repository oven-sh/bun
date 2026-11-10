// The transpiler gives each arm of the name a require of its own, and reads the arms that are written: `flag === 1 ? require("os") : require(maybe)`.
// The whole name was taken for unknown, and the loader knows no "bun:os": the require threw.
const flag = process.argv.length > 5 ? 2 : 1;
const maybe = process.env.NO_SUCH_VARIABLE_HERE;
const made = JSON.parse('"bun:os"');
const say = (name, load) => {
  let got;
  try {
    got = typeof load().cpus;
  } catch (error) {
    got = "THROWS " + error.code;
  }
  console.log(name, got);
};
say("an arm beside an unknown", () => require(flag === 1 ? "bun:os" : maybe));
say("an arm behind an unknown", () => require(flag === 2 ? maybe : "bun:os"));
say("an arm that is joined", () => require(flag === 1 ? "bun:" + "os" : maybe));
say("an arm that is a template", () => require(flag === 1 ? `bun:os` : maybe));
say("an arm in an arm", () => require(flag === 2 ? maybe : flag === 1 ? "bun:os" : maybe));
say("an arm in the first arm", () => require(flag === 1 ? (flag === 1 ? "bun:os" : maybe) : maybe));
say("the unknown arm runs", () => require(flag === 2 ? "bun:os" : maybe));
say("the unknown arm makes the same text", () => require(flag === 2 ? "bun:os" : made));
say("another name for require", () => { const load = require; return load(flag === 1 ? "bun:os" : maybe); });
say("an arm that any loader reads", () => require(flag === 1 ? "node:os" : maybe));

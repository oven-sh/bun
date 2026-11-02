// A `--define` of `require` whose value is a path below a variable of the file calls what the path holds where the text spells `require`: no file is loaded.
// Flags: --define require=loader.load
const loader = {
  load(name) {
    return { name: "what loader.load returned for " + name };
  },
};
console.log(require("./lib.cjs").name);

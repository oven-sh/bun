// A `--define` of `require` whose value names a function of the file calls that function where the text spells `require`: no file is loaded.
// Flags: --define require=load
function load(name) {
  return { name: "what load returned for " + name };
}
console.log(require("./lib.cjs").name);

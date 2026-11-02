// A `--define` of `import.meta.require` whose value names a function of the file calls that function where the text spells `import.meta.require`: no file is loaded.
// Flags: --define import.meta.require=load
function load(name) {
  return { name: "what load returned for " + name };
}
console.log(import.meta.require("./lib.cjs").name);

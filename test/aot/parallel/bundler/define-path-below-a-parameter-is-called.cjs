// A `--define` whose value is a dotted path is called on its holder: where a parameter has the first name of the path, the member of the parameter is called.
// Flags: --define FLOOR=Math.floor
function round(Math) {
  return FLOOR(2.5);
}
console.log(round({ floor: () => "the parameter" }));

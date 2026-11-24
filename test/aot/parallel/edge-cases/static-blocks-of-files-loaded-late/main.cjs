// A function in a static block that nothing calls names a class of its file. The file may run again.
function load(name) {
  return all[name]();
}
const all = {
  in_a_block: () => require("./in_a_block.cjs"),
  called_in_a_block: () => require("./called_in_a_block.cjs"),
};
for (const name in all) {
  console.log(name, load(name).live(), load(name) === load(name));
}

// A function that nothing calls names a constant of its file, and so does one that is declared at the top. The files may run again.
function load(name) {
  return all[name]();
}
const all = {
  two_readers: () => require("./two_readers.cjs"),
  list: () => require("./list.cjs"),
  table: () => require("./table.cjs"),
  pattern: () => require("./pattern.cjs"),
};
for (const name in all) {
  console.log(name, load(name).live(), load(name) === load(name));
}

// A function that nothing calls names a class of its file, which a function around it holds. The files may run again.
function load(name) {
  return all[name]();
}
const all = {
  arrow_in_method: () => require("./arrow_in_method.cjs"),
  declared_in_method: () => require("./declared_in_method.cjs"),
  method_of_a_class_in_a_function: () => require("./method_of_a_class_in_a_function.cjs"),
  called_where_it_is_written: () => require("./called_where_it_is_written.cjs"),
  callback: () => require("./callback.cjs"),
};
for (const name in all) {
  console.log(name, load(name).live(), load(name) === load(name));
}

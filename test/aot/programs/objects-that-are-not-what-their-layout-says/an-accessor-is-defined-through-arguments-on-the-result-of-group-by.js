function create() {
  return Object.groupBy([], () => "group");
}
function make() {
  return create();
}
function change() {
  try {
    Object.defineProperty(arguments[0], name, { get });
  } catch (e) {}
}
const o = make();
try {
  Reflect.get(o);
} catch (e) {}
change(o);

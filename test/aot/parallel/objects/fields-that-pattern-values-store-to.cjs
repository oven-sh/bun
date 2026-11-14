// The value on the right of a pattern is evaluated before the keys of its targets and its defaults, which are written before it.
function keyOfTarget() {
  const box = { field: {} }, names = {};
  [names[typeof box.field]] = [((box.field = 1), 5)];
  return Object.keys(names).join();
}
function keyOfNestedTarget() {
  const box = { field: () => 1 }, names = {};
  ({ a: [...names[typeof box.field]] } = { a: [(box.field = "text")] });
  return Object.keys(names).join();
}
function defaultOfItem() {
  const box = { field: {} };
  let type;
  [type = typeof box.field] = [void (box.field = 1)];
  return type;
}
function defaultOfProperty() {
  const box = { field: [] };
  let answer;
  ({ a: answer = box.field ? "truthy" : "falsy" } = { b: (box.field = 0) });
  return answer;
}
function keyOfProperty() {
  const box = { field: {} };
  let value;
  ({ [typeof box.field]: value } = { number: "stored", object: "written", other: (box.field = 1) });
  return value;
}
function keyOfStore() {
  const box = { field: {} }, names = {};
  names[typeof box.field] = box.field = 1;
  return Object.keys(names).join();
}
console.log(keyOfTarget(), keyOfNestedTarget(), defaultOfItem(), defaultOfProperty(), keyOfProperty(), keyOfStore());

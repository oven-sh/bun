// Getters that a for-in loop defined on an instance of a class. Every member of each descriptor is looked at, and what is a function is called.
class WithAccessor {}
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return error.name;
  }
}
function shown(target, key) {
  const found = Object.getOwnPropertyDescriptor(target, key);
  const parts = [];
  for (const name of ["value", "get", "set", "writable", "enumerable", "configurable"]) {
    const part = found[name];
    parts.push(name + "=" + (typeof part === "function" ? "function " + String(told(part)) : String(part)));
  }
  return parts.join();
}
function exportAll(target, all) {
  for (const name in all) Object.defineProperty(target, name, { get: all[name], enumerable: true });
}
for (const target of [new WithAccessor(), {}]) {
  exportAll(target, { one: () => 1, two: () => 2 });
  console.log(
    Reflect.ownKeys(target)
      .map(name => shown(target, name))
      .join(" ; "),
  );
}

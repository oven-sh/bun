interface Patch { name?: string; age?: number }
function user(name: string, age: number) { return { name, age }; }
function run() {
  const u = user("ann", 7);
  const patch: Patch = {};
  Object.defineProperty(u, "name", {});
  console.log(Reflect.defineProperty(u, "name", { value: "zed" }), u.name);
}
run();

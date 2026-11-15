interface Patch { name?: string; age?: number }
function user(name: string, age: number) { return { name, age }; }
function run() {
  const u = user("ann", 7);
  const patch: Patch = {};
  Object.defineProperty(u, "name", { value: "zed", enumerable: true });
  console.log(Object.keys(u).join(), JSON.stringify(u), u.name, u.age);
}
run();

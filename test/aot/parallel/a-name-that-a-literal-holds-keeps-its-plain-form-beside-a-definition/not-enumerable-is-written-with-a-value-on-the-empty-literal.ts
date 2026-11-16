interface Patch { name?: string; age?: number }
function user(name: string, age: number) { return { name, age }; }
function run() {
  const u = user("ann", 7);
  const patch: Patch = {};
  Object.defineProperty(patch, "name", { value: "laid", enumerable: false });
  console.log(Object.keys(u).join(), JSON.stringify(u), typeof patch.name, JSON.stringify(patch));
}
run();

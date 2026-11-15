interface Patch { name?: string; age?: number }
function user(name: string, age: number) { return { name, age }; }
function guest(age: number, name: string) { return { age, name }; }
function run() {
  const u = user("ann", 7), g = guest(9, "bob");
  const patch: Patch = {};
  Object.defineProperty(u, "name", { writable: false });
  console.log(JSON.stringify(g));
}
run();

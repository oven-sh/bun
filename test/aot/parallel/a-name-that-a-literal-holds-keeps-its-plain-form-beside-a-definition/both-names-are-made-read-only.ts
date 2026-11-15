interface Patch { name?: string; age?: number }
function user(name: string, age: number) { return { name, age }; }
function run() {
  const u = user("ann", 7);
  const patch: Patch = {};
  console.log(JSON.stringify(u));
  Object.defineProperty(u, "name", { writable: false });
  Object.defineProperty(u, "age", { writable: false });
}
run();

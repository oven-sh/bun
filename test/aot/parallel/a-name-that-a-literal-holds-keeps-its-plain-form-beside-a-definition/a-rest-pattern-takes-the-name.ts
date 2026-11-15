interface Patch { name?: string; age?: number }
function user(name: string, age: number) { return { name, age }; }
function run() {
  const u = user("ann", 7);
  const patch: Patch = {};
  const { age, ...rest } = u;
  console.log(age, JSON.stringify(rest));
  Object.defineProperty(u, "name", { writable: false });
}
run();

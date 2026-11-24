function user(name: string, age: number) { return { name, age }; }
function run() {
  const u = user("ann", 7);
  const patch = {} as { name: string; age: number };
  console.log(JSON.stringify(u));
  Object.defineProperty(u, "name", { writable: false });
}
run();

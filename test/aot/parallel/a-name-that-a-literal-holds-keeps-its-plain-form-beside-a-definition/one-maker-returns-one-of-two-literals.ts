interface User { name: string; age?: number }
function user(name: string, age?: number): User { return age === undefined ? { name } : { name, age }; }
function run() {
  const full = user("ann", 7), part = user("bob");
  Object.defineProperty(full, "age", { writable: false });
  console.log(JSON.stringify(full), JSON.stringify(part));
}
run();

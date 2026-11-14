interface User { name: string; age?: number }
function full(name: string, age: number): User { return { name, age }; }
function part(name: string): User { return { name }; }
function run() {
  const f = full("ann", 7), p = part("bob");
  Object.defineProperty(p, "age", { value: 9 });
  console.log(JSON.stringify(f), JSON.stringify(p), p.age);
}
run();

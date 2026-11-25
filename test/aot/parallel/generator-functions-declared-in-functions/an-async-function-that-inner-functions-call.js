const n = +process.argv[2] || 3;
async function f() {
  async function g() { g.count = (g.count || 0) + 1; return g.count; }
  const a = () => g(), b = () => g();
  return [await a(), await b()].join();
}
f().then((s) => console.log(String(s)));

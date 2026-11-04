Bun.Glob.prototype.list = [1, 2];
let h = globalThis;
for (const name of JSON.parse(`["Bun", "Glob", "prototype"]`)) h = h[name];
h.list = { length: 3 };
function read() {
  return Bun.Glob.prototype.list.length;
}
console.log(read());

Bun.stdout.list = [1, 2];
let h = globalThis;
for (const name of JSON.parse(`["Bun", "stdout"]`)) h = h[name];
h.list = { length: 3 };
function read() {
  return Bun.stdout.list.length;
}
console.log(read());

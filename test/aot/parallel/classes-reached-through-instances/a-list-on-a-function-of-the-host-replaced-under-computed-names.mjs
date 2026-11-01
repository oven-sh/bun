Bun.gzipSync.list = [1, 2];
let h = globalThis;
for (const name of JSON.parse(`["Bun", "gzipSync"]`)) h = h[name];
h.list = { length: 3 };
function read() {
  return Bun.gzipSync.list.length;
}
console.log(read());

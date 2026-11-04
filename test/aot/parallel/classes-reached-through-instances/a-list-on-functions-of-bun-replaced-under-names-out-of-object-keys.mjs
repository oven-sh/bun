Bun.gzipSync.list = [1, 2];
for (const name of Object.keys(Bun)) if (name.startsWith("gzip")) Bun[name].list = { length: 3 };
function read() {
  return Bun.gzipSync.list.length;
}
console.log(read());

Bun.gzipSync.list = [1, 2];
const name = JSON.parse(`"gzipSync"`);
Bun[name].list = { length: 3 };
function read() {
  return Bun.gzipSync.list.length;
}
console.log(read());

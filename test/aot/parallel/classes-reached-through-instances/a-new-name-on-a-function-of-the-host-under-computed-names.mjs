let h = globalThis;
for (const name of JSON.parse(`["Bun", "gzipSync"]`)) h = h[name];
h.extra = 41;
h.extraFunction = function () {
  return "called";
};
function read() {
  return Bun.gzipSync.extra;
}
function call() {
  return Bun.gzipSync.extraFunction.call(null);
}
console.log(read());
console.log(call());

// With a getter on the global object: compiled answers as plain.
Object.defineProperty(globalThis, "magic", {
  get() {
    return (globalThis.count = (globalThis.count ?? 0) + 1);
  },
  configurable: true,
});
function f() {
  return magic + magic;
}
console.log(f(), f(), typeof magic, count);

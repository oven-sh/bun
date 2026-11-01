// Getter added over a field between reads: compiled answers as plain.
const o = { v: 1 };
function read(p) {
  return p.v + 1;
}
console.log(read(o));
Object.defineProperty(o, "v", {
  get() {
    return "got";
  },
});
console.log(read(o));

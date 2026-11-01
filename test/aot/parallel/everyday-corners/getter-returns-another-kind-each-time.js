// Getter returns another kind each time: compiled answers as plain.
let n = 0;
const o = {
  get v() {
    return n++ % 2 ? "text" : 1;
  },
};
function read(p) {
  return p.v + 1;
}
console.log(read(o), read(o), read(o));

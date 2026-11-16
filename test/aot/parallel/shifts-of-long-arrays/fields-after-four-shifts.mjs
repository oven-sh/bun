// Fields that a class defines on an array that its base class returns.
const view = new Uint8Array(50);
for (let i = 0; i < 50; i++) view[i] = i;
class Given {
  constructor(value) {
    return value;
  }
}
class Marked extends Given {
  foo = 1;
  static mark(array) {
    new Marked(array);
  }
}
class Hidden extends Given {
  #count = 5;
  static mark(array) {
    new Hidden(array);
  }
  static has(array) {
    return #count in array ? array.#count++ : -1;
  }
}
const kept = [];
let sum = 0;
function deal(turns, shifts, mark) {
  for (let k = 0; k < turns; k++) {
    const a = [...view];
    for (let j = 0; j < shifts; j++) a.shift();
    mark(a);
    kept.push(a);
    sum = (sum * 31 + a.length + (a.foo ?? 0)) | 0;
  }
}
for (let shifts = 2; shifts < 7; shifts++) {
  deal(30, shifts, Marked.mark);
  Bun.gc(true);
  deal(30, shifts, Hidden.mark);
  Bun.gc(true);
}
console.log(sum, kept.length, Object.keys(kept[3]).slice(-2).join(), kept.map(a => a[40] + a[0]).join(), kept.map(Hidden.has).join(""), kept.map(Hidden.has).join(""));

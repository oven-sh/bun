// assigns the four fields of a new instance of a class that has an accessor
class Holder {
  a = 0;
  b = 0;
  c = 0;
  d = 0;
  get doubled() {
    return this.a * 2;
  }
}
const sources = [
  { a: 1, b: 2, c: 3, d: 4 },
  { a: 5, b: 6, c: 7, d: 8 },
];
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const holder = new Holder();
    Object.assign(holder, sources[i & 1]);
    sum += holder.a + holder.d;
  }
}

console.log(sum);

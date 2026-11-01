// A class below Array with a private field stores a field after super(), and the loop asks each object whether it is an instance.
class A extends Array {
  #p = 1;
  constructor(n: number) {
    super();
    this.r = this.#p + this.m() + n;
  }
  r: number;
  m(): number {
    return 10;
  }
}
let sum = 0;
for (let i = 0; i < 100000; i++) {
  const a = new A(i & 1);
  if (a instanceof A) sum += a.r;
}
console.log(sum);

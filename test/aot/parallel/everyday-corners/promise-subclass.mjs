// Promise subclass: compiled answers as plain.
class P extends Promise {
  static n = 0;
  constructor(f) {
    super(f);
    P.n++;
  }
}
const p = P.resolve(1).then(v => v + 1);
console.log(p instanceof P, await p, P.n);

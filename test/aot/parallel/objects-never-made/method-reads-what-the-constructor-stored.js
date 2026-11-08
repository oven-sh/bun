// `new Counter().add(i)`: the read of `add` finds a method, so nobody is handed the object: the method reads what the constructor stored, and no object is made.
// COUNT: operations <= 20
class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
}
function inLoop(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Counter().add(i)) | 0;
  return sum;
}
function once(i) {
  return new Counter().add(i);
}
console.log(inLoop(20000), once(Number(process.argv[2] ?? 5)));

try {
} catch (error) {
}
try {
  console.log("scene 1", sum, last instanceof A1, Object.getPrototypeOf(last) === A1.prototype, Object.keys(last).join(), typeof last.m, A1.has(last));
} catch (error) {
}
class A2 extends Array {
  #p;
  constructor(n) {
    super();
    this.r = (this.#p ?? 1) + this.m() + n;
  }
  m() {
    return 10;
  }
}
function OtherA2() {}
OtherA2.prototype = Object.create(A2.prototype);
try {
  for (let i = 0; i < 20000; i++) {
    const a = Reflect.construct(A2, [i & 1], OtherA2);
    sum += a.push(i) + a.length;
  }
} catch (error) {
}
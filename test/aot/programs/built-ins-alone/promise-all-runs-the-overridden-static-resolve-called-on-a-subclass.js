let calls = 0;
class Special extends Promise {
  static count = 0;
  static resolve(firstValue) {
    calls++;
    this.count++;
    console.log("static resolve", arguments.length, typeof firstValue, this === Special);
    return super.resolve(...arguments);
  }
}
const result = Special.all("an");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0].length, settled[0]);
console.log(typeof settled[1], settled[1].length, settled[1]);
console.log(result instanceof Special, calls, Special.count);

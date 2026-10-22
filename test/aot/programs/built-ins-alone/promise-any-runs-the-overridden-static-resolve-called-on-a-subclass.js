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
const result = Special.any("an");
const settled = await result;
console.log(typeof settled, settled.length, settled);
console.log(result instanceof Special, calls, Special.count);

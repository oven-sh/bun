let calls = 0;
class Special extends Promise {
  count = 0;
  then(firstValue, secondValue, thirdValue) {
    calls++;
    this.count++;
    console.log("then", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super.then(...arguments);
  }
}
const result = Special.all("an");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0].length, settled[0]);
console.log(typeof settled[1], settled[1].length, settled[1]);
console.log(result instanceof Special, calls, result.count);

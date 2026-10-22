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
const result = Special.race("an");
const settled = await result;
console.log(typeof settled, settled.length, settled);
console.log(result instanceof Special, calls, result.count);

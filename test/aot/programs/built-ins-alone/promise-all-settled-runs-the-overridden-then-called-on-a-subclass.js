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
const result = Special.allSettled("an");
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], Object.keys(settled[0]).join());
console.log(typeof settled[0].status, settled[0].status.length, settled[0].status);
console.log(typeof settled[0].value, settled[0].value.length, settled[0].value, typeof settled[1], Object.keys(settled[1]).join());
console.log(typeof settled[1].status, settled[1].status.length, settled[1].status);
console.log(typeof settled[1].value, settled[1].value.length, settled[1].value);
console.log(result instanceof Special, calls, result.count);

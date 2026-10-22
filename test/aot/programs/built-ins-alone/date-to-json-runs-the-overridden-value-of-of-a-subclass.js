let calls = 0;
class Special extends Date {
  count = 0;
  valueOf(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("valueOf", arguments.length, typeof firstValue, typeof secondValue);
    return super.valueOf(...arguments);
  }
}
const special = new Special(86400000.5);
console.log("made");
const result = special.toJSON(1.5);
console.log(typeof result, result.length, result);
console.log(calls, special.count);

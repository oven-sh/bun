let calls = 0;
class Special extends Set {
  count = 0;
  add(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("add", arguments.length, typeof firstValue, typeof secondValue);
    return super.add(...arguments);
  }
}
const result = new Special("an");
console.log(typeof result, result.size, result.has("a"), result.has("n"));
console.log(typeof [...result][1], [...result][1].length, [...result][1]);
console.log(result instanceof Special, calls, result.count);

let calls = 0;
class Special extends RegExp {
  count = 0;
  get ignoreCase() {
    calls++;
    this.count++;
    console.log("ignoreCase");
    return super.ignoreCase;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".split(special, 2);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(calls, special.count);

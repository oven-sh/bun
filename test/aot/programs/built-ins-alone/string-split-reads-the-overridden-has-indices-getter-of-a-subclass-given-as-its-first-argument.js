let calls = 0;
class Special extends RegExp {
  count = 0;
  get hasIndices() {
    calls++;
    this.count++;
    console.log("hasIndices");
    return super.hasIndices;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".split(special);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2], typeof result[3], result[3] === undefined);
console.log(calls, special.count);

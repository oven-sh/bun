let calls = 0;
class Special extends RegExp {
  count = 0;
  get flags() {
    calls++;
    this.count++;
    console.log("flags");
    return super.flags;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special[Symbol.match]("an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(calls, special.count);

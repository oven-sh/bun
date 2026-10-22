let calls = 0;
class Special extends RegExp {
  count = 0;
  get multiline() {
    calls++;
    this.count++;
    console.log("multiline");
    return super.multiline;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special[Symbol.split]("an", "-");
console.log(Array.isArray(result), result.length);
console.log(calls, special.count);

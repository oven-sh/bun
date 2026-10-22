let calls = 0;
class Special extends RegExp {
  count = 0;
  get unicode() {
    calls++;
    this.count++;
    console.log("unicode");
    return super.unicode;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special[Symbol.split]("an", "-");
console.log(Array.isArray(result), result.length);
console.log(calls, special.count);

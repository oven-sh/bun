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
const result = special[Symbol.replace]("an", 2.5);
console.log(typeof result, result.length, result);
console.log(calls, special.count);

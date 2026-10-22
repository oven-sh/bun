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
const result = special.toString();
console.log(typeof result, result.length, result);
console.log(calls, special.count);

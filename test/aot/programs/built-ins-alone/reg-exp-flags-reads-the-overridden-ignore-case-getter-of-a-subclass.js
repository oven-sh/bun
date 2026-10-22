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
const result = special.flags;
console.log(typeof result, result.length, result);
console.log(calls, special.count);

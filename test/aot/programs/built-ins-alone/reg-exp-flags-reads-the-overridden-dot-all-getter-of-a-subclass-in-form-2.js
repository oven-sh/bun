let calls = 0;
class Special extends RegExp {
  get dotAll() {
    calls++;
    console.log("dotAll");
    return super.dotAll;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special.flags;
console.log(typeof result, result.length, result);
console.log(calls);

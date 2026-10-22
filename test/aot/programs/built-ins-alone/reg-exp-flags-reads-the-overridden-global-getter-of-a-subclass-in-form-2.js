let calls = 0;
class Special extends RegExp {
  get global() {
    calls++;
    console.log("global");
    return super.global;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special.flags;
console.log(typeof result, result.length, result);
console.log(calls);

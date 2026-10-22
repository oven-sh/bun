let calls = 0;
class Special extends RegExp {
  get sticky() {
    calls++;
    console.log("sticky");
    return super.sticky;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special.flags;
console.log(typeof result, result.length, result);
console.log(calls);

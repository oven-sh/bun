let calls = 0;
class Special extends RegExp {
  count = 0;
  get sticky() {
    calls++;
    this.count++;
    console.log("sticky");
    return super.sticky;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".replace(special, "-");
console.log(typeof result, result.length, result);
console.log(calls, special.count);

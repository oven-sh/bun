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
const result = "banana".replace(special, 2.5);
console.log(typeof result, result.length, result);
console.log(calls, special.count);

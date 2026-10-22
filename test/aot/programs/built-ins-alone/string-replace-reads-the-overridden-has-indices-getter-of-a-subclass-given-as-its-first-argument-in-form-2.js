let calls = 0;
class Special extends RegExp {
  count = 0;
  get hasIndices() {
    calls++;
    this.count++;
    console.log("hasIndices");
    return super.hasIndices;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".replace(special, "-");
console.log(typeof result, result.length, result);
console.log(calls, special.count);

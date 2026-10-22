let calls = 0;
class Special extends RegExp {
  count = 0;
  exec(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("exec", arguments.length, typeof firstValue, typeof secondValue);
    return super.exec(...arguments);
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".replace(special, "-");
console.log(typeof result, result.length, result);
console.log(calls, special.count);

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
const result = special[Symbol.split]("an", 2.5);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result[1], result[1].length, result[1]);
console.log(calls, special.count);

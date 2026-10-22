let calls = 0;
class Special extends RegExp {
  exec(firstValue, secondValue) {
    calls++;
    console.log("exec", arguments.length, typeof firstValue, typeof secondValue);
    return super.exec(...arguments);
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special.test("an");
console.log(typeof result, result);
console.log(calls);

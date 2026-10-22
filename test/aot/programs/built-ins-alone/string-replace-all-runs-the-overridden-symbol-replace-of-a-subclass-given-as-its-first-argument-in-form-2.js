let calls = 0;
class Special extends RegExp {
  count = 0;
  [Symbol.replace](firstValue, secondValue, thirdValue) {
    calls++;
    this.count++;
    console.log("Symbol.replace", arguments.length, typeof firstValue, typeof secondValue, typeof thirdValue);
    return super[Symbol.replace](...arguments);
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".replaceAll(special, "-");
console.log(typeof result, result.length, result);
console.log(calls, special.count);

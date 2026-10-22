let calls = 0;
class Special extends RegExp {
  count = 0;
  [Symbol.search](firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("Symbol.search", arguments.length, typeof firstValue, typeof secondValue);
    return super[Symbol.search](...arguments);
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = "banana".search(special);
console.log(typeof result, result + 1);
console.log(calls, special.count);

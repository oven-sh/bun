let calls = 0;
class Special extends RegExp {
  static count = 0;
  static get [Symbol.species]() {
    calls++;
    this.count++;
    console.log("Symbol.species", this === Special);
    return RegExp;
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special[Symbol.split]("an", "-");
console.log(Array.isArray(result), result.length);
console.log(calls, Special.count);

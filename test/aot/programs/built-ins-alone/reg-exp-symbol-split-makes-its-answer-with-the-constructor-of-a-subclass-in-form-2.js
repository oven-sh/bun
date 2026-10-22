let calls = 0;
class Special extends RegExp {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const special = new Special("(a)(?<rest>n)?(?<none>x)?", "g");
console.log("made");
const result = special[Symbol.split]("an", "-");
console.log(Array.isArray(result), result.length);
console.log(calls);

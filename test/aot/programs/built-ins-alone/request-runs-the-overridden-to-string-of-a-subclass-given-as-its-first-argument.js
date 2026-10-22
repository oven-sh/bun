let calls = 0;
class Special extends URL {
  count = 0;
  toString(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("toString", arguments.length, typeof firstValue, typeof secondValue);
    return super.toString(...arguments);
  }
}
const special = new Special("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
console.log("made");
const result = new Request(special, null);
console.log(result instanceof Request, Object.keys(result).join());
console.log(calls, special.count);

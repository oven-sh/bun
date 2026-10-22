let calls = 0;
const second = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
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
const result = new Request(special, second);
console.log(result instanceof Request, Object.keys(result).join());
console.log(calls, special.count);

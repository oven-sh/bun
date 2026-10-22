let calls = 0;
class Special extends Request {
  count = 0;
  get body() {
    calls++;
    this.count++;
    console.log("body");
    return super.body;
  }
}
const special = new Special("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
console.log("made");
const result = new Request(special, null);
console.log(result instanceof Request, Object.keys(result).join(), typeof special, Object.keys(special).join());
console.log(typeof special.count, special.count + 1);
console.log(calls, special.count);

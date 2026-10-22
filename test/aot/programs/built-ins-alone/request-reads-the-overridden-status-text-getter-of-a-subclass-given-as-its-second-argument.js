let calls = 0;
const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
class Special extends Response {
  count = 0;
  get statusText() {
    calls++;
    this.count++;
    console.log("statusText");
    return super.statusText;
  }
}
const special = new Special("[1.5]", { status: 201, headers: { first: "1" } });
console.log("made");
const result = new Request(first, special);
console.log(result instanceof Request, Object.keys(result).join(), typeof special, Object.keys(special).join());
console.log(typeof special.count, special.count + 1);
console.log(calls, special.count);

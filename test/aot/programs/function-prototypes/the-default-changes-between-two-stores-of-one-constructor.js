// The change comes in the middle of a constructor, between the test and the store.
const log = [];
let arm = false;
function poke() {
  if (arm) {
    arm = false;
    Object.defineProperty(Message.prototype, "method", { set(v) { log.push("set method " + v); }, get() { return "getter"; }, configurable: true });
  }
  return 7;
}
function Message(url, method) {
  this.url = url;
  this.extra = poke();
  this.method = method;
}
Message.prototype.url = "";
Message.prototype.method = null;
let last;
for (let i = 0; i < 60; i++) last = new Message("/" + i, "GET");
log.push(Object.keys(last).join(), last.method);
arm = true;
last = new Message("/x", "POST");
log.push(Object.keys(last).join(), last.method);
last = new Message("/y", "PUT");
log.push(Object.keys(last).join(), last.method);
console.log(log.join(" | "));

class Cause {
  said = "made up";
  tell() {
    return this.said;
  }
}
const controller = new AbortController();
controller.abort(new Cause());
const reason = controller.signal.reason as Cause;
console.log(reason.tell(), String(reason instanceof Cause));

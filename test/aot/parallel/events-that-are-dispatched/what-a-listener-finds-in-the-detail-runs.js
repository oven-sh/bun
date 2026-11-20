const order = [];
class Job {
  constructor(name) {
    this.name = name;
  }
  run() {
    order.push(`ran ${this.name}`);
    return this.name.length;
  }
}
const target = new EventTarget();
target.addEventListener("job", event => order.push(`length ${event.detail.run()}`));
target.addEventListener("failed", event => order.push(`${event.message}: ${event.error.run()}`));
target.dispatchEvent(new CustomEvent("job", { detail: new Job("first") }));
target.dispatchEvent(new CustomEvent("job", { get detail() { order.push("asked"); return new Job("second"); } }));
target.dispatchEvent(new ErrorEvent("failed", { message: "it fell", error: new Job("third") }));
console.log(`${order.join(" | ")}`);

// Exit code: 1
class Thing { size = 1; [Symbol.for("nodejs.util.inspect.custom")]() { return "custom " + this.size; } }
const thing = new Thing();
const target = new EventTarget();
target.addEventListener("go", () => { throw thing; });
target.dispatchEvent(new Event("go"));

// Each Worker gives display names and names to functions and classes of this file, shows them in frames, and ends. The main thread names its own frames before, between and after.
const frames = error =>
  error.stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .filter(name => name && !name.includes("/") && !name.includes(":"))
    .slice(0, 3)
    .join(" < ");
class Shape {
  static displayName = "ShapeAtFirst";
  constructor() {
    this.seen = frames(new Error("x"));
  }
}
class Plain {
  constructor() {
    this.seen = frames(new Error("x"));
  }
}
function work() {
  return frames(new Error("x"));
}
const make = () => function made() { return frames(new Error("x")); };
const hide = new Function("f", "return f");
function show(label) {
  const made = hide(make());
  const lines = [new Shape().seen, new Plain().seen, work(), made()];
  Shape.displayName = "Shape" + label;
  hide(Plain).displayName = "Plain" + label;
  hide(work).displayName = "work" + label;
  Object.defineProperty(made, "name", { value: "made" + label });
  lines.push(new Shape().seen, new Plain().seen, work(), made());
  return lines.join(" | ");
}
if (Bun.isMainThread) {
  console.log("main:", show("Main"));
  for (let round = 0; round < 6; round++) {
    const worker = new Worker(new URL(import.meta.url));
    const closed = new Promise(resolve => worker.addEventListener("close", resolve));
    const said = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
    console.log("worker", round + ":", said);
    if (round % 2) worker.terminate();
    else worker.postMessage("end");
    await closed;
    Bun.gc(true);
    console.log("main after", round + ":", new Shape().seen, "|", new Plain().seen, "|", work());
  }
  console.log("main:", show("Again"));
} else {
  postMessage(show("InWorker"));
  addEventListener("message", () => process.exit(0));
}

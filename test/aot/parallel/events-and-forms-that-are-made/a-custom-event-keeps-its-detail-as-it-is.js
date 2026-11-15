const read = [];
const watched = members => new Proxy(members, { get(target, name) { read.push(String(name)); return target[name]; } });
const held = { count: 1, more() { return ++this.count; } };
const event = new CustomEvent({ toString: () => "a" }, watched({ detail: held, bubbles: 1, cancelable: "", composed: {} }));
console.log(`${event.type} ${event.detail === held} ${event.detail.more()} ${event.bubbles} ${event.cancelable} ${event.composed} ${read.join()}`);
console.log(`${new CustomEvent("b").detail} ${new CustomEvent("b", {}).detail} ${new CustomEvent("b", { detail: undefined }).detail} ${new CustomEvent("b", null).detail}`);
const target = new EventTarget();
target.addEventListener("a", heard => console.log(`${heard === event} ${heard.detail.more()} ${heard instanceof CustomEvent} ${heard.isTrusted}`));
console.log(`${target.dispatchEvent(event)} ${held.count}`);
event.initCustomEvent("c", true, false, [4, 5]);
console.log(`${event.type} ${event.detail.length} ${event.bubbles} ${event.cancelable}`);
event.initCustomEvent({ toString: () => "d" });
console.log(`${event.type} ${event.detail} ${event.bubbles}`);
const said = [];
for (const make of [() => new CustomEvent(), () => new CustomEvent("x", 1), () => CustomEvent("x"), () => new CustomEvent(Symbol("x")), () => event.initCustomEvent(), () => event.initCustomEvent.call({}, "x")]) {
  try {
    make();
    said.push("made");
  } catch (error) {
    said.push(error.name);
  }
}
console.log(`${said.join()}`);

class Bus extends EventTarget {
  heard = [];
  say(name, detail) {
    return this.dispatchEvent(new CustomEvent(name, { detail, cancelable: true }));
  }
}
const bus = new Bus();
bus.addEventListener("a", function (event) {
  this.heard.push(`${event.target === bus} ${event.currentTarget === this} ${event.detail.text()} ${event.eventPhase}`);
  event.preventDefault();
});
bus.addEventListener("a", { handleEvent(event) { bus.heard.push(`${event.defaultPrevented} ${event.detail.count}`); } }, { once: true });
const detail = { count: 2, text() { return `count ${this.count}`; } };
console.log(`${bus.say("a", detail)} ${bus.say("a", detail)} ${bus.say("b", detail)}`);
console.log(`${bus.heard.join(" | ")}`);
const said = [];
for (const wrong of [() => bus.dispatchEvent(), () => bus.dispatchEvent({ type: "a" }), () => bus.dispatchEvent("a"), () => bus.dispatchEvent.call({}, new Event("a"))]) {
  try {
    said.push(String(wrong()));
  } catch (error) {
    said.push(error.name);
  }
}
console.log(`${said.join()}`);

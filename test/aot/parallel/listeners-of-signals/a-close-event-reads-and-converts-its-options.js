const read = [];
const watched = members => new Proxy(members, { get(target, name) { read.push(String(name)); return target[name]; } });
const close = new CloseEvent("a", watched({ code: { valueOf: () => 65537 }, reason: { toString: () => "made up" }, wasClean: 1, bubbles: "x" }));
console.log(`${close.type} ${close.code} ${close.reason} ${close.wasClean} ${close.bubbles} ${close instanceof Event} ${close.isTrusted}`);
const plain = new CloseEvent({ toString: () => "b" });
console.log(`${plain.type} ${plain.code} [${plain.reason}] ${plain.wasClean} ${read.join()}`);
const said = [];
for (const make of [() => new CloseEvent(), () => new CloseEvent("x", 1), () => CloseEvent("x"), () => new CloseEvent(Symbol("x")), () => new CloseEvent("x", null)]) {
  try {
    make();
    said.push("made");
  } catch (error) {
    said.push(error.name);
  }
}
console.log(`${said.join()}`);

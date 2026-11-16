const read = [];
const watched = members => new Proxy(members, { get(target, name) { read.push(String(name)); return target[name]; } });
const thrown = new RangeError("made up");
const event = new ErrorEvent("a", watched({ message: { toString: () => "said" }, filename: 7, lineno: { valueOf: () => 4294967297 }, colno: "3", error: thrown, cancelable: true }));
console.log(`${event.type} ${event.message} ${event.filename} ${event.lineno} ${event.colno} ${event.error === thrown} ${event.error.message} ${event.cancelable}`);
console.log(`${read.join()}`);
const plain = new ErrorEvent("b");
console.log(`[${plain.message}] [${plain.filename}] ${plain.lineno} ${plain.colno} ${plain.error} ${plain instanceof Event} ${plain.isTrusted}`);
console.log(`${new ErrorEvent("c", { error: undefined }).error} ${new ErrorEvent("c", { error: 0 }).error} ${typeof new ErrorEvent("c", { error: () => 1 }).error}`);
const said = [];
for (const make of [() => new ErrorEvent(), () => new ErrorEvent("x", "y"), () => ErrorEvent("x"), () => new ErrorEvent("x", { message: Symbol("x") }), () => new ErrorEvent("x", { lineno: 1n })]) {
  try {
    make();
    said.push("made");
  } catch (error) {
    said.push(error.name);
  }
}
console.log(`${said.join()}`);

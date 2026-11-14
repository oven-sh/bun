const { Readable, Writable, Duplex, isDestroyed } = require("node:stream");
const makers = { Readable: () => new Readable({ read() {} }), Writable: () => new Writable({ write() {} }), Duplex: () => new Duplex({ read() {}, write() {} }) };
for (const [label, make] of Object.entries(makers)) {
  for (const name of ["_readableState", "_writableState"]) {
    for (const plan of ["the state each time", "the state, then nothing", "nothing, then the state", "the state, then a destroyed one"]) {
      const made = make(), state = made[name];
      let runs = 0;
      const answers = { "the state each time": () => state, "the state, then nothing": () => (runs > 1 ? undefined : state), "nothing, then the state": () => (runs > 1 ? state : undefined), "the state, then a destroyed one": () => (runs > 1 ? { destroyed: true } : state) };
      Object.defineProperty(made, name, { configurable: true, get() { runs++; return answers[plan](); } });
      let answer;
      try { answer = String(isDestroyed(made)); } catch (error) { answer = "throws " + (error && error.name); }
      console.log(label, name, "|", plan, "|", answer, runs);
    }
  }
}
const order = [];
const watched = new Proxy({}, {});
const plainObject = {};
for (const name of ["_readableState", "_writableState", "write", "on", "pipe", "destroyed"]) Object.defineProperty(plainObject, name, { get() { order.push(name); return undefined; } });
console.log(String(isDestroyed(plainObject)), order.join(","), String(isDestroyed(watched)), String(isDestroyed(null)), String(isDestroyed(7)));

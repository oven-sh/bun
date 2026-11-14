// Handlers by name in an object, with once and arguments
class Emitter {
  handlers = {};
  on(name, call) {
    (this.handlers[name] ||= []).push(call);
    return this;
  }
  once(name, call) {
    const wrapped = (...all) => {
      this.handlers[name].splice(this.handlers[name].indexOf(wrapped), 1);
      call.apply(this, all);
    };
    return this.on(name, wrapped);
  }
  emit(name, ...all) {
    for (const call of [...(this.handlers[name] || [])]) call.apply(this, all);
    return (this.handlers[name] || []).length;
  }
}
function run(n) {
  const out = [];
  const emitter = new Emitter().on("a", x => out.push(x)).once("a", (x, y) => out.push(x + y)).on("b", function () { out.push(Object.keys(this.handlers).join("")); });
  for (let i = 0; i < 2; i++) out.push("=" + emitter.emit("a", n, i + 1));
  return out.join(" ") + " " + emitter.emit("b") + emitter.emit("none") + out.length;
}
console.log(run(1));
console.log(run(20));
console.log(run(-1));

function emitter() {
  const listeners = {};
  return {
    on(name, listener) {
      (listeners[name] ??= []).push(listener);
    },
    emit(name, ...given) {
      for (const listener of listeners[name] ?? []) listener(...given);
    },
  };
}
const bus = emitter();
const heard = [];
bus.on("say", word => heard.push("first " + word));
bus.on("say", word => heard.push("second " + word));
bus.emit("say", "hi");
bus.emit("none");
console.log(heard.join());

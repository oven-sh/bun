import EventEmitter from "node:events";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:events\").listenerCount = () => \"mine\"; return \"stored\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => EventEmitter.listenerCount(new EventEmitter(), "x")));

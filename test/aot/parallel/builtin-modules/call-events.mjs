import EventEmitter from "node:events";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("const E = process.getBuiltinModule(\"node:events\"); const e = new E(); let seen = 0; e.on(\"x\", v => { seen += v; }); e.emit(\"x\", 41); return seen + 1;"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => new EventEmitter().listenerCount("x")));

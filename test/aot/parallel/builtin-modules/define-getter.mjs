import path from "node:path";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("Object.defineProperty(process.getBuiltinModule(\"node:path\"), \"sep\", { get() { return \"!\"; }, configurable: true }); return \"defined\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => path.sep));

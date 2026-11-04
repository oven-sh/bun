import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("Object.defineProperty(process.getBuiltinModule(\"node:buffer\"), \"atob\", { get() { return () => \"mine\"; }, configurable: true }); return \"defined\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => buffer.atob("YQ==")));

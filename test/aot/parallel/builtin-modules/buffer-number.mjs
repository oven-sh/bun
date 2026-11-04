import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:buffer\").atob = 5; return \"stored\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => buffer.atob("YQ==")), typeof buffer.atob);

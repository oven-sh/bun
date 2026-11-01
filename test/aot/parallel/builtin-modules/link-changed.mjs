import path from "node:path";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("Object.setPrototypeOf(process.getBuiltinModule(\"node:path\"), { above: \"mine\" }); return \"linked\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => path.above));

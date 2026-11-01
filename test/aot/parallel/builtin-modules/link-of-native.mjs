import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("Object.setPrototypeOf(process.getBuiltinModule(\"node:util/types\"), { above: \"mine\" }); return \"linked\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => types.above), tell(() => Object.getPrototypeOf(types).above));

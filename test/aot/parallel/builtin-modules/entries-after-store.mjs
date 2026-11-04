import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:util/types\").isDate = () => \"mine\"; return \"stored\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => Object.entries(types).find(([key]) => key === "isDate")[1](1)));

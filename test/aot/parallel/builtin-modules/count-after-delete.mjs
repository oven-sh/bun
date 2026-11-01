import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("const before = Object.keys(process.getBuiltinModule(\"node:util/types\")).length; delete process.getBuiltinModule(\"node:util/types\").isDate; return before;"));
const answer = tell(() => new Function(text)());
console.log(answer, Number(answer) - Object.keys(types).length);

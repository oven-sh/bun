import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("Object.defineProperty(process.getBuiltinModule(\"node:util/types\"), \"isDate\", { get() { return () => \"mine\"; }, configurable: true }); return \"defined\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => typeof types.isDate), tell(() => types.isDate.name));

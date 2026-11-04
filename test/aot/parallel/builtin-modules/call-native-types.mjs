import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("return process.getBuiltinModule(\"node:util/types\").isDate(new Date(0)) + \" \" + process.getBuiltinModule(\"node:util/types\").isRegExp(1);"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => types.isDate(1)));

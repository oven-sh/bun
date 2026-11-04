import types from "node:util/types";
import buffer from "node:buffer";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:util/types\").nope = 1; process.getBuiltinModule(\"node:buffer\").nope = 1; return \"added\";"));
const answer = tell(() => new Function(text)());
console.log(answer, Object.keys(types).includes("nope"), Object.keys(buffer).includes("nope"));

import buffer from "node:buffer";
import path from "node:path";
import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("for (const name of [\"node:buffer\", \"node:path\", \"node:util/types\"]) process.getBuiltinModule(name).nope = 1; return \"added\";"));
const answer = tell(() => new Function(text)());
console.log(answer, "nope" in buffer, "nope" in path, Object.hasOwn(types, "nope"));

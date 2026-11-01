import buffer from "node:buffer";
import path from "node:path";
import types from "node:util/types";
import fs from "node:fs";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("for (const name of [\"node:buffer\", \"node:path\", \"node:util/types\", \"node:fs\"]) process.getBuiltinModule(name).nope = 1; return \"added\";"));
const answer = tell(() => new Function(text)());
console.log(answer, typeof buffer.nope, typeof path.nope, typeof types.nope, typeof fs.nope);

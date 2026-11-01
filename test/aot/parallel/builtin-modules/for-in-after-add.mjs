import types from "node:util/types";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:util/types\").nope = 1; return \"added\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => {
  let seen = 0;
  for (const key in types) seen += key === "nope" ? 1 : 0;
  return seen;
}));

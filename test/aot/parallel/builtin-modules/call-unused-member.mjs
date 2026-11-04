import path from "node:path";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("return process.getBuiltinModule(\"node:path\").extname(\"a.b\");"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => path.join("a", "b")));

import { basename } from "node:path";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:path\").basename = () => \"mine\"; return \"stored\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => basename("/a/b")));

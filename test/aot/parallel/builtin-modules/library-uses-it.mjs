import util from "node:util";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("process.getBuiltinModule(\"node:util/types\").isDate = () => true; return \"stored\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => util.inspect(1)), tell(() => util.types.isDate(1)));

import util from "node:util";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.code ?? error.constructor.name;
  }
};
const text = JSON.parse(JSON.stringify("Object.defineProperty(process.getBuiltinModule(\"node:util/types\"), \"isDate\", { get() { return () => true; }, configurable: true }); return \"defined\";"));
const answer = tell(() => new Function(text)());
console.log(answer, tell(() => util.inspect(new Date(0)).length > 0), tell(() => util.isDeepStrictEqual(new Date(0), new Date(0))));

import types from "node:util/types";
const text = JSON.parse(JSON.stringify("Object.defineProperty(process.getBuiltinModule(\"node:util/types\"), \"isDate\", { get() { return () => \"mine\"; }, configurable: true });"));
new Function(text)();
console.log(String(types.isDate.length));

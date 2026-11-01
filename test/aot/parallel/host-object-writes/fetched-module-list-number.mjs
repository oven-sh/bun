// Alone: the stores of other programs would be seen beside its own
import module from "node:module";
const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
new Function(JSON.parse(JSON.stringify('process.getBuiltinModule("node:module").builtinModules = 5;')))();
console.log(
  tell(() => module.builtinModules.length),
  tell(() => typeof module.builtinModules[0]),
  tell(() => module.builtinModules.includes("fs")),
);

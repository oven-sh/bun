// What only asks about a name answers as in plain Bun, whether or not the module is in the executable: isBuiltin, builtinModules, require.resolve, import.meta.resolve and Bun.resolveSync.
import { builtinModules, isBuiltin } from "node:module";

for (const name of process.env.NAMES.split(",")) {
  const answers = [isBuiltin(name), builtinModules.includes(name.replace("node:", ""))];
  for (const resolve of [() => require.resolve(name), () => import.meta.resolve(name), () => Bun.resolveSync(name, import.meta.dir)]) {
    try {
      answers.push(resolve());
    } catch (error) {
      answers.push(error.code);
    }
  }
  console.log(name, answers.join(" "));
}

// A CommonJS file may delete `module.exports`, define it anew or lay a getter there. Whoever imports the file gets what the loader then finds on the module object.
import untouched from "./untouched.cjs";
import deleted from "./deleted.cjs";
import deletedByReflect from "./deleted-by-reflect.cjs";
import storedAgain from "./stored-again.cjs";
import defined from "./defined.cjs";
import getter from "./getter.cjs";
import fixed from "./fixed.cjs";

const say = value => (typeof value === "object" && value !== null ? "{" + Object.keys(value).join() + "}" : String(value));
console.log(say(untouched), say(deleted), say(deletedByReflect), say(storedAgain), say(defined), say(getter), say(fixed));
for (const name of ["untouched", "deleted", "stored-again", "defined", "getter", "fixed"]) {
  const namespace = await import(`./${name}.cjs`);
  console.log(name, say(namespace.default), Object.keys(namespace).join());
}

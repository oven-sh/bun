// The bun: modules follow the rule of the node: modules. bun:jsc is imported by name, bun:sqlite is not. `bun` itself is the global Bun and always there.
import "bun:jsc";

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
  console.log(name, await import(name).then(loaded => typeof loaded, error => error.code));
}
console.log(require(process.env.NAMES.split(",")[0]) === Bun);

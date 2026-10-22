// The pattern of an optional dependency: try a name, fall back. After a load has failed, the same name fails the same way again, other names load, and a module that is in is the same object as before.
import path from "node:path";

function optional(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}
const [missing, present] = process.env.NAMES.split(",");
console.log(optional(missing), optional(missing), optional(present) === path);
const codes = [];
for (let i = 0; i < 3; i++) {
  try {
    require(missing);
  } catch (error) {
    codes.push(error.code);
  }
  await import(missing).catch(error => codes.push(error.code));
}
console.log(codes.join());
console.log(optional(present) === path, (await import(present)).default === path);

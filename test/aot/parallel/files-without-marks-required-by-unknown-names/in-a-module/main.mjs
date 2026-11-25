const doors = { front: "./bolt.cjs" };
function lay(name, path) {
  doors[name] = path;
}
import.meta.require(doors.front);
await import("./bolt.cjs");
console.log(globalThis.kinds.join(), typeof lay);

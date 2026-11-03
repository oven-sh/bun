// A definition that leaves a key of require.cache anything but a writable, enumerable and configurable data property gives the key that shape.
// The loader keeps the entry: require() answers with the module, and loads nothing again.
const held = require("bun:sqlite");
const shape = descriptor => {
  if (!descriptor) return "none";
  if ("get" in descriptor) return ["accessor", descriptor.enumerable, descriptor.configurable].join(" ");
  return [typeof descriptor.value, descriptor.value === require.cache["bun:sqlite"], descriptor.writable, descriptor.enumerable, descriptor.configurable].join(" ");
};
const describe = () => [shape(Object.getOwnPropertyDescriptor(require.cache, "bun:sqlite")), Object.keys(require.cache).includes("bun:sqlite"), "bun:sqlite" in require.cache, require("bun:sqlite") === held].join(" | ");

console.log("at first:", describe());
Object.defineProperty(require.cache, "bun:sqlite", { enumerable: false });
console.log("not enumerable:", describe(), Reflect.ownKeys(require.cache).includes("bun:sqlite"));
Object.defineProperty(require.cache, "bun:sqlite", { writable: false });
console.log("read-only:", describe(), Reflect.set(require.cache, "bun:sqlite", 1));
const entry = require.cache["bun:sqlite"];
Object.defineProperty(require.cache, "bun:sqlite", { get: () => entry });
console.log("an accessor:", describe(), require.cache["bun:sqlite"] === entry);
console.log("deleted:", delete require.cache["bun:sqlite"], describe());

require("ws");
Object.defineProperty(require.cache, "ws", { configurable: false });
console.log("not configurable:", Reflect.deleteProperty(require.cache, "ws"), "ws" in require.cache, typeof require("ws").WebSocket);
